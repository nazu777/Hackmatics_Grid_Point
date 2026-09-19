import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Minus, AlertTriangle, Sparkles, Check } from 'lucide-react';
import { MapView } from './MapView';
import { optimizeNetwork } from '../services/api';
import type {
  Neighborhood, Warehouse, Assignment, OptimizationConfig, OptimizationResult,
  BasemapStyle, ColorByMode, ZoneColorMap
} from '../types';

const API_BASE = (import.meta.env.VITE_API_URL as string) || '/api';
const MAX_WAREHOUSES = 10;

/** Self-contained expansion contracts (kept local so parallel work in shared types/ is untouched). */
export interface ExpansionRelief {
  warehouse_id: string;
  before_orders: number;
  after_orders: number;
  orders_reduced: number;
  pct_reduced: number;
}

export interface ExpansionResponse {
  result: OptimizationResult;
  new_warehouse_ids: string[];
  relief: ExpansionRelief[];
  added: number;
}

type ResizeMode = 'add' | 'reduce';

interface PreviewState {
  mode: ResizeMode;
  after: OptimizationResult;
  target: number;
  newIds: string[];
  removedIds: string[];
  relief: ExpansionRelief[];
  live: boolean;
}

// ---------- tiny local geo helpers (offline fallback only) ----------
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371.0088;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function weiszfeldLocal(pts: { lat: number; lon: number }[], wts: number[]): { lat: number; lon: number } {
  let lat = pts.reduce((s, p, i) => s + p.lat * wts[i], 0) / Math.max(1e-9, wts.reduce((s, w) => s + w, 0));
  let lon = pts.reduce((s, p, i) => s + p.lon * wts[i], 0) / Math.max(1e-9, wts.reduce((s, w) => s + w, 0));
  for (let it = 0; it < 60; it++) {
    let nLat = 0; let nLon = 0; let den = 0;
    for (let i = 0; i < pts.length; i++) {
      const d = Math.max(1e-7, haversineKm(lat, lon, pts[i].lat, pts[i].lon));
      const w = wts[i] / d;
      nLat += pts[i].lat * w; nLon += pts[i].lon * w; den += w;
    }
    if (den === 0) break;
    const nla = nLat / den; const nlo = nLon / den;
    if (Math.abs(nla - lat) + Math.abs(nlo - lon) < 1e-7) { lat = nla; lon = nlo; break; }
    lat = nla; lon = nlo;
  }
  return { lat, lon };
}

/** Offline fallback: same greedy relief idea as the server (fixed existing sites, nearest reassign). */
function localExpand(
  neighborhoods: Neighborhood[],
  existing: Warehouse[],
  addCount: number,
  config: OptimizationConfig,
  before: OptimizationResult
): ExpansionResponse {
  const K0 = existing.length;
  const K_total = Math.min(K0 + addCount, MAX_WAREHOUSES, neighborhoods.length);
  const sites = existing.map((w) => ({ lat: w.latitude, lon: w.longitude }));
  const rMax = config.radius_enabled ? config.R_max_km ?? null : null;

  for (let s = K0; s < K_total; s++) {
    const labels = neighborhoods.map((n) => {
      let best = 0; let bd = Infinity;
      sites.forEach((st, k) => {
        const d = haversineKm(n.latitude, n.longitude, st.lat, st.lon);
        if (d < bd) { bd = d; best = k; }
      });
      return best;
    });
    const loads = new Array(sites.length).fill(0);
    const bad = new Array(sites.length).fill(0);
    neighborhoods.forEach((n, i) => {
      loads[labels[i]] += Number(n.daily_orders) || 0;
      const d = haversineKm(n.latitude, n.longitude, sites[labels[i]].lat, sites[labels[i]].lon);
      if (rMax && d > rMax) bad[labels[i]] += 1;
    });
    const donor = bad.some((b: number) => b > 0)
      ? bad.indexOf(Math.max(...bad))
      : loads.indexOf(Math.max(...loads));
    const mine = neighborhoods
      .map((n, i) => ({ n, i, d: haversineKm(n.latitude, n.longitude, sites[donor].lat, sites[donor].lon) }))
      .filter((x) => labels[x.i] === donor)
      .sort((a, b) => a.d - b.d);
    const subset = mine.slice(Math.max(0, mine.length - Math.max(1, Math.floor(mine.length / 2))));
    const med = weiszfeldLocal(
      subset.map((x) => ({ lat: x.n.latitude, lon: x.n.longitude })),
      subset.map((x) => Number(x.n.daily_orders) || 1)
    );
    const tooClose = sites.some((st) => haversineKm(med.lat, med.lon, st.lat, st.lon) < 0.5);
    sites.push(tooClose
      ? { lat: subset[subset.length - 1].n.latitude, lon: subset[subset.length - 1].n.longitude }
      : med);
  }

  const warehouses: Warehouse[] = sites.map((st, k) => ({
    warehouse_id: `W${k + 1}`,
    latitude: +st.lat.toFixed(6),
    longitude: +st.lon.toFixed(6),
    capacity: config.capacity_enabled ? config.C_max : null,
    radius_km: rMax,
    infra_cost: config.infra_cost_per_warehouse,
    assigned_orders: 0
  }));
  const assignments: Assignment[] = [];
  let unw = 0; let wtd = 0; let cost = 0; let infeas = 0;
  const perWh = warehouses.map(() => ({ orders: 0, dists: [] as number[], count: 0 }));
  neighborhoods.forEach((n) => {
    let best = 0; let bd = Infinity;
    sites.forEach((st, k) => {
      const d = haversineKm(n.latitude, n.longitude, st.lat, st.lon);
      if (d < bd) { bd = d; best = k; }
    });
    const w = Number(n.daily_orders) || 0;
    const ok = !(rMax && bd > rMax);
    if (!ok) infeas++;
    assignments.push({
      neighborhood_id: n.neighborhood_id,
      warehouse_id: warehouses[best].warehouse_id,
      distance_km: +bd.toFixed(2),
      weighted_distance: +(w * bd).toFixed(2),
      cost: +(w * bd * config.cost_per_km).toFixed(2),
      within_radius: ok,
      is_feasible: ok
    });
    perWh[best].orders += w; perWh[best].dists.push(bd); perWh[best].count++;
    unw += bd; wtd += w * bd; cost += w * bd * config.cost_per_km;
  });
  warehouses.forEach((wh, k) => { wh.assigned_orders = perWh[k].orders; });
  const demand = neighborhoods.reduce((s, n) => s + (Number(n.daily_orders) || 0), 0);
  const metrics = {
    total_unweighted_distance_km: +unw.toFixed(2),
    total_weighted_distance_km_orders: +wtd.toFixed(2),
    total_cost: +(cost + K_total * config.infra_cost_per_warehouse).toFixed(2),
    total_fuel_cost: 0,
    fuel_live: false,
    avg_distance_per_order_km: +(wtd / Math.max(1, demand)).toFixed(2),
    avg_weighted_distance_km: +(wtd / Math.max(1, neighborhoods.length)).toFixed(2),
    warehouses: warehouses.map((wh, k) => ({
      warehouse_id: wh.warehouse_id,
      assigned_orders: perWh[k].orders,
      utilization_pct: config.capacity_enabled && config.C_max
        ? +((perWh[k].orders / config.C_max) * 100).toFixed(1) : null,
      avg_distance_km: perWh[k].dists.length
        ? +(perWh[k].dists.reduce((a, b) => a + b, 0) / perWh[k].dists.length).toFixed(2) : 0,
      neighborhood_count: perWh[k].count
    })),
    infeasible_assignments: infeas,
    feasibility_ratio: +((neighborhoods.length - infeas) / Math.max(1, neighborhoods.length)).toFixed(4)
  };
  const b = before.metrics;
  const result: OptimizationResult = {
    config: { ...config, K: K_total },
    warehouses,
    assignments,
    metrics,
    comparison: {
      baseline: { metrics: before.metrics, warehouses: before.warehouses, assignments: before.assignments },
      optimized: { metrics, warehouses, assignments },
      delta: {
        distance_saved_km: +Math.max(0, b.total_unweighted_distance_km - unw).toFixed(2),
        weighted_distance_saved: +Math.max(0, b.total_weighted_distance_km_orders - wtd).toFixed(2),
        cost_saved: +Math.max(0, b.total_cost - metrics.total_cost).toFixed(2),
        pct_distance_saved: +((Math.max(0, b.total_weighted_distance_km_orders - wtd) / Math.max(0.001, b.total_weighted_distance_km_orders)) * 100).toFixed(2),
        pct_cost_saved: +((Math.max(0, b.total_cost - metrics.total_cost) / Math.max(0.001, b.total_cost)) * 100).toFixed(2)
      }
    },
    is_feasible: infeas === 0,
    infeasibility_reason: infeas ? `${infeas} assignments exceed radius limit after expansion` : null,
    fuel_note: 'Offline estimate — connect the API for exact fuel economics'
  };
  const beforeLoad = new Map(before.warehouses.map((w) => [w.warehouse_id, w.assigned_orders || 0]));
  return {
    result,
    new_warehouse_ids: warehouses.slice(K0).map((w) => w.warehouse_id),
    relief: warehouses.slice(0, K0).map((w) => {
      const bb = beforeLoad.get(w.warehouse_id) ?? 0;
      const aa = w.assigned_orders || 0;
      return { warehouse_id: w.warehouse_id, before_orders: bb, after_orders: aa, orders_reduced: bb - aa, pct_reduced: +(((bb - aa) / Math.max(1, bb)) * 100).toFixed(1) };
    }),
    added: K_total - K0
  };
}

async function expandNetworkClient(
  neighborhoods: Neighborhood[],
  warehouses: Warehouse[],
  addCount: number,
  config: OptimizationConfig,
  before: OptimizationResult
): Promise<{ data: ExpansionResponse; live: boolean }> {
  try {
    const res = await fetch(`${API_BASE}/expand`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ neighborhoods, warehouses, add_count: addCount, config })
    });
    if (res.ok) return { data: (await res.json()) as ExpansionResponse, live: true };
  } catch { /* offline → local fallback */ }
  return { data: localExpand(neighborhoods, warehouses, addCount, config, before), live: false };
}

/** Before→after delta computed directly off the two layouts (truthful in add and reduce modes). */
function layoutDelta(before: OptimizationResult, after: OptimizationResult): { pctCost: number; costSaved: number } {
  const b = before.metrics.total_cost;
  const a = after.metrics.total_cost;
  const saved = b - a;
  return { pctCost: +((saved / Math.max(0.001, b)) * 100).toFixed(2), costSaved: +saved.toFixed(2) };
}

// ---------- before/after swipe map ----------
const COMPARE_H = 360;

const BeforeAfterCompare: React.FC<{
  neighborhoods: Neighborhood[];
  before: OptimizationResult;
  after: OptimizationResult;
  afterCaption: string;
  deltaNote: string;
  zoneColors: ZoneColorMap;
}> = ({ neighborhoods, before, after, afterCaption, deltaNote, zoneColors }) => {
  const [pos, setPos] = useState(50);
  const [basemap, setBasemap] = useState<BasemapStyle>('dark');
  const [colorBy, setColorBy] = useState<ColorByMode>('warehouse');
  const frameRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const setFromClientX = (clientX: number) => {
    const el = frameRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos(Math.min(98, Math.max(2, ((clientX - r.left) / Math.max(1, r.width)) * 100)));
  };

  const radiusFor = (r: OptimizationResult) =>
    r.config.radius_enabled ? (r.config.R_max_km ?? null) : null;

  return (
    <div className="space-y-2">
      <div
        ref={frameRef}
        className="relative w-full overflow-hidden rounded-2xl border border-[#E4E1D2] select-none"
        style={{ height: COMPARE_H, touchAction: 'none' }}
        onPointerDown={(e) => { dragging.current = true; (e.target as HTMLElement).setPointerCapture?.(e.pointerId); setFromClientX(e.clientX); }}
        onPointerMove={(e) => { if (dragging.current) setFromClientX(e.clientX); }}
        onPointerUp={() => { dragging.current = false; }}
        onPointerCancel={() => { dragging.current = false; }}
      >
        {/* AFTER fills the frame (right side) */}
        <div className="absolute inset-0" style={{ pointerEvents: 'none' }}>
          <MapView
            neighborhoods={neighborhoods}
            warehouses={after.warehouses}
            assignments={after.assignments}
            radiusKm={radiusFor(after)}
            height={COMPARE_H}
            minimal
            basemap={basemap}
            onBasemapChange={setBasemap}
            colorBy={colorBy}
            onColorByChange={setColorBy}
            zoneColors={zoneColors}
          />
        </div>
        {/* BEFORE clipped to the left of the divider */}
        <div
          className="absolute inset-0"
          style={{ pointerEvents: 'none', clipPath: `inset(0 ${100 - pos}% 0 0)` }}
        >
          <MapView
            neighborhoods={neighborhoods}
            warehouses={before.warehouses}
            assignments={before.assignments}
            radiusKm={radiusFor(before)}
            height={COMPARE_H}
            minimal
            basemap={basemap}
            onBasemapChange={setBasemap}
            colorBy={colorBy}
            onColorByChange={setColorBy}
            zoneColors={zoneColors}
          />
        </div>
        {/* divider */}
        <div className="absolute top-0 bottom-0" style={{ left: `${pos}%`, width: 0 }}>
          <div className="absolute top-0 bottom-0 -left-px w-[2px] bg-white shadow-[0_0_8px_rgba(0,0,0,0.5)]" />
          <div className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-white shadow-xl border border-black/10 flex items-center justify-center text-[13px] font-extrabold text-ink cursor-ew-resize">
            ⟷
          </div>
        </div>
        {/* side labels */}
        <div className="absolute top-2 left-2 px-2.5 py-1 rounded-full bg-black/65 text-white text-[11px] font-bold">
          Before · K={before.warehouses.length} · ${before.metrics.total_cost.toLocaleString()}
        </div>
        <div className="absolute top-2 right-2 px-2.5 py-1 rounded-full bg-[#14424E]/90 text-white text-[11px] font-bold">
          {afterCaption}{deltaNote ? ` · ${deltaNote}` : ''}
        </div>
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 px-2.5 py-1 rounded-full bg-white/95 text-[10px] font-semibold text-ink-soft shadow">
          Drag the handle (or use the slider below) to compare halves
        </div>
      </div>
      <input
        type="range"
        min={2}
        max={98}
        value={Math.round(pos)}
        onChange={(e) => setPos(Number(e.target.value))}
        aria-label="Before / after divider"
        className="w-full accent-[#14424E] cursor-ew-resize"
      />
    </div>
  );
};

// ---------- panel ----------
export const WarehouseExpansion: React.FC<{
  neighborhoods: Neighborhood[];
  before: OptimizationResult;
  zoneColors?: ZoneColorMap;
  /** Called with the final layout after user confirms — parent applies it to the main map. */
  onApply?: (result: OptimizationResult) => void;
}> = ({ neighborhoods, before, zoneColors = {}, onApply }) => {
  const K0 = before.warehouses.length;
  const kMin = 1;
  const kMax = Math.max(1, Math.min(MAX_WAREHOUSES, neighborhoods.length));
  const [target, setTarget] = useState(K0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [offline, setOffline] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [appliedK, setAppliedK] = useState<number | null>(null);

  // A fresh optimization run invalidates any preview built off the old layout.
  useEffect(() => {
    setPreview(null);
    setConfirming(false);
    setAppliedK(null);
    setTarget(before.warehouses.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [before]);

  const mode: ResizeMode | null = target > K0 ? 'add' : target < K0 ? 'reduce' : null;
  const stale = !!preview && preview.target !== target;

  const reliefRows = useMemo(
    () => (preview?.relief ?? []).filter((r) => r.orders_reduced > 0),
    [preview]
  );

  const run = async () => {
    if (!mode || loading) return;
    setLoading(true);
    setError(null);
    setConfirming(false);
    try {
      if (mode === 'add') {
        const { data, live } = await expandNetworkClient(
          neighborhoods, before.warehouses, target - K0, before.config, before
        );
        setPreview({
          mode, after: data.result, target,
          newIds: data.new_warehouse_ids, removedIds: [],
          relief: data.relief, live
        });
        setOffline(!live);
      } else {
        // Reduce: re-plan the network from scratch with fewer warehouses.
        const after = await optimizeNetwork(neighborhoods, { ...before.config, K: target });
        const beforeIds = new Set(before.warehouses.map((w) => w.warehouse_id));
        const afterIds = new Set(after.warehouses.map((w) => w.warehouse_id));
        setPreview({
          mode, after, target,
          newIds: [],
          removedIds: [...beforeIds].filter((id) => !afterIds.has(id)),
          relief: [],
          live: true
        });
        setOffline(false);
      }
    } catch (e: any) {
      setError(e?.message || 'Resize failed');
    } finally {
      setLoading(false);
    }
  };

  const apply = () => {
    if (!preview || !onApply) return;
    onApply(preview.after);
    setAppliedK(preview.target);
    setConfirming(false);
  };

  const delta = preview ? layoutDelta(before, preview.after) : null;
  const deltaNote = delta
    ? `${delta.costSaved >= 0 ? '−' : '+'}${Math.abs(delta.pctCost)}% vs current`
    : '';

  return (
    <div className="card p-5 space-y-4">
      <div>
        <h3 className="font-bold text-sm text-ink flex items-center gap-2">
          <Plus className="w-4 h-4 text-[#14424E]" /> Add or remove warehouses
        </h3>
        <p className="text-[11px] text-ink-faint mt-1">
          {mode === 'add'
            ? 'Adding keeps every current warehouse where it is — new sites relieve the heaviest loads or cover poorly served areas.'
            : mode === 'reduce'
              ? 'Removing re-plans the network with fewer warehouses; remaining sites move to optimal spots.'
              : `Currently K=${K0}. Pick a target count, preview the change, then apply it to the main map.`}
        </p>
      </div>

      {/* Target stepper */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => setTarget((t) => Math.max(kMin, t - 1))}
          disabled={target <= kMin || loading}
          aria-label="Fewer warehouses"
          className="w-9 h-9 rounded-full bg-cream-deep border border-[#E4E1D2] flex items-center justify-center text-ink hover:bg-gold-100 disabled:opacity-40 transition cursor-pointer"
        >
          <Minus className="w-4 h-4" />
        </button>
        <div className="text-center min-w-[92px]">
          <div className="font-mono font-extrabold text-lg text-ink leading-none">
            {K0} → <span className="text-[#14424E]">{target}</span>
          </div>
          <div className="text-[10px] text-ink-faint mt-0.5">warehouses</div>
        </div>
        <button
          onClick={() => setTarget((t) => Math.min(kMax, t + 1))}
          disabled={target >= kMax || loading}
          aria-label="More warehouses"
          className="w-9 h-9 rounded-full bg-cream-deep border border-[#E4E1D2] flex items-center justify-center text-ink hover:bg-gold-100 disabled:opacity-40 transition cursor-pointer"
        >
          <Plus className="w-4 h-4" />
        </button>
        <button
          onClick={run}
          disabled={!mode || loading}
          className="ml-auto flex items-center gap-1.5 px-5 py-2 bg-[#14424E] hover:bg-[#0d333d] disabled:opacity-50 text-white rounded-full text-xs font-bold transition cursor-pointer"
        >
          <Sparkles className="w-3.5 h-3.5" />
          {loading ? 'Previewing…' : mode === 'add' ? `Preview +${target - K0}` : mode === 'reduce' ? `Preview −${K0 - target}` : 'Pick a target'}
        </button>
      </div>
      <p className="text-[10px] text-ink-faint -mt-2">Range {kMin}–{kMax} (K ≤ {MAX_WAREHOUSES}, ≤ nodes)</p>

      {error && (
        <div className="p-3 bg-rose-50 text-rose-700 border border-rose-200 rounded-xl text-xs flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" /> <span>{error}</span>
        </div>
      )}

      {preview && (
        <div className="space-y-4 animate-in fade-in duration-300">
          {stale && (
            <div className="p-2.5 bg-gold-50 border border-gold-200 rounded-xl text-[11px] text-ink-soft">
              Target changed to K={target} — this preview is for K={preview.target}. Hit preview again to refresh.
            </div>
          )}
          <div className="p-3 bg-cream-deep/70 border border-[#E4E1D2] rounded-2xl text-xs text-ink-soft">
            {preview.mode === 'add' ? (
              <><span className="font-bold text-ink">✨ {preview.newIds.join(', ')}</span> added (K {K0} → {preview.target})</>
            ) : (
              <><span className="font-bold text-ink">➖ consolidated to K={preview.target}</span> (re-planned{preview.removedIds.length ? `, retired ${preview.removedIds.join(', ')}` : ''})</>
            )}
            {delta && (
              <> · avg {before.metrics.avg_distance_per_order_km} → {preview.after.metrics.avg_distance_per_order_km} km ·{' '}
              <span className="font-bold text-[#14424E]">
                {delta.costSaved >= 0 ? '−' : '+'}{Math.abs(delta.pctCost)}% cost (${Math.abs(delta.costSaved).toLocaleString()})
              </span></>
            )}
            {offline && <span className="text-ink-faint"> · offline estimate</span>}
          </div>

          {preview.mode === 'add' && reliefRows.length > 0 && (
            <div className="space-y-1.5">
              {reliefRows.map((r) => (
                <div key={r.warehouse_id} className="flex items-center gap-2 text-xs">
                  <span className="font-mono font-extrabold text-[#14424E] w-8">{r.warehouse_id}</span>
                  <div className="flex-1 h-2 rounded-full bg-cream-deep overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-[#14424E] to-gold"
                      style={{ width: `${Math.min(100, Math.max(0, 100 - r.pct_reduced))}%` }}
                    />
                  </div>
                  <span className="font-mono text-ink-soft whitespace-nowrap">
                    {r.before_orders.toLocaleString()} → {r.after_orders.toLocaleString()}
                    <span className="font-bold text-[#14424E]"> −{r.pct_reduced}%</span>
                  </span>
                </div>
              ))}
            </div>
          )}

          {preview.mode === 'reduce' && (
            <div className="space-y-1.5">
              {preview.after.warehouses.map((w) => {
                const m = preview.after.metrics.warehouses.find((x) => x.warehouse_id === w.warehouse_id);
                return (
                  <div key={w.warehouse_id} className="flex items-center gap-2 text-xs">
                    <span className="font-mono font-extrabold text-[#14424E] w-8">{w.warehouse_id}</span>
                    <span className="font-mono text-ink-soft">
                      {(w.assigned_orders || 0).toLocaleString()} orders · {m?.neighborhood_count || 0} nodes · avg {m?.avg_distance_km ?? 0} km
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          <BeforeAfterCompare
            neighborhoods={neighborhoods}
            before={before}
            after={preview.after}
            afterCaption={`After · K=${preview.after.warehouses.length} · $${preview.after.metrics.total_cost.toLocaleString()}`}
            deltaNote={deltaNote}
            zoneColors={zoneColors}
          />

          {/* Confirm + apply to main map */}
          {onApply && !stale && (
            confirming ? (
              <div className="p-4 bg-gold-50 border border-gold-300 rounded-2xl space-y-3">
                <p className="text-xs text-ink">
                  <span className="font-bold">Apply K={preview.target} to the main map?</span>{' '}
                  This replaces the current warehouse layout everywhere (map, compare, exports).
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={apply}
                    className="flex items-center gap-1.5 px-5 py-2 bg-[#14424E] hover:bg-[#0d333d] text-white rounded-full text-xs font-bold transition cursor-pointer"
                  >
                    <Check className="w-3.5 h-3.5" /> Confirm apply
                  </button>
                  <button
                    onClick={() => setConfirming(false)}
                    className="px-5 py-2 bg-white border border-[#E4E1D2] hover:bg-cream-deep text-ink rounded-full text-xs font-bold transition cursor-pointer"
                  >
                    Keep previewing
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setConfirming(true)}
                className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-grape-500 hover:bg-grape-600 text-white rounded-full text-sm font-bold shadow-md shadow-grape-500/20 transition cursor-pointer"
              >
                {appliedK === preview.target ? `Applied K=${appliedK} ✓ — apply again` : `Happy with K=${preview.target}? Apply to main map`}
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
};
