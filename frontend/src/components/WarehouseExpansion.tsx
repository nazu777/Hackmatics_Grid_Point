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

/** Phase-E policy toggles (schema.md §2.4 expansion_policy): keep vs abandon/change/demolish infra, keep vs sell vehicles, horizon + revenue. */
export interface ExpansionPolicy {
  allow_abandon_infra: boolean;
  allow_sell_vehicles: boolean;
  horizon_months: number;
  revenue_per_order: number;
  demolition_cost: number;
  salvage_value: number;
  resale_value: number;
  infra_cost_new?: number | null;
}

export const DEFAULT_EXPANSION_POLICY: ExpansionPolicy = {
  allow_abandon_infra: false,
  allow_sell_vehicles: false,
  horizon_months: 12,
  revenue_per_order: 0,
  demolition_cost: 0,
  salvage_value: 0,
  resale_value: 0,
  infra_cost_new: null,
};

export interface RankedExpansionOption {
  plan: string;
  npv: number;
  infra: number;
  fuel: number;
  fuel_saved?: number;
  delivery_saved: number;
  revenue: number;
  friction?: number;
  proceeds?: number;
  new_warehouses: string[];
  abandoned_infra: string[];
  sold_vehicles: string[];
}

export interface ExpansionRecommendation {
  recommended_plan: { new_warehouses: string[]; added_vehicles: string[]; abandoned_infra: string[]; sold_vehicles: string[] };
  ranked_options: RankedExpansionOption[];
  rationale: string;
}

export interface ExpansionResponse {
  result: OptimizationResult;
  new_warehouse_ids: string[];
  relief: ExpansionRelief[];
  added: number;
  policy?: ExpansionPolicy;
  recommendation?: ExpansionRecommendation & { layouts?: Record<string, { warehouses: Warehouse[]; assignments: Assignment[]; metrics: any }> };
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
  policyKey?: string;
  recommendation?: ExpansionResponse['recommendation'];
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
  before: OptimizationResult,
  policy: ExpansionPolicy = DEFAULT_EXPANSION_POLICY
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
  const horizon = Math.max(1, Math.min(120, policy.horizon_months || 12));
  const infraEach = policy.infra_cost_new != null ? policy.infra_cost_new : (config.infra_cost_per_warehouse || 0);
  const demandTotal = neighborhoods.reduce((s, n) => s + (Number(n.daily_orders) || 0), 0);
  const score = (afterM: typeof metrics, friction = 0, proceeds = 0) => {
    const deliverySaved = (before.metrics.total_cost - afterM.total_cost) * horizon;
    const fuelSaved = ((before.metrics.total_fuel_cost || 0) - (afterM.total_fuel_cost || 0)) * horizon;
    const revenue = policy.revenue_per_order * demandTotal * horizon * (afterM.feasibility_ratio ?? 1)
      - policy.revenue_per_order * demandTotal * horizon * (before.metrics.feasibility_ratio ?? 1);
    const infra = infraEach * (K_total - K0);
    return {
      infra: +infra.toFixed(2),
      fuel: +((afterM.total_fuel_cost || 0) * horizon).toFixed(2),
      fuel_saved: +fuelSaved.toFixed(2),
      delivery_saved: +deliverySaved.toFixed(2),
      revenue: +revenue.toFixed(2),
      friction: +friction.toFixed(2),
      proceeds: +proceeds.toFixed(2),
      npv: +(deliverySaved + revenue - infra - friction + proceeds).toFixed(2),
    };
  };
  const keepEco = score(metrics);
  const ranked: RankedExpansionOption[] = [{
    plan: `keep-all + ${K_total - K0} new site(s)`,
    ...keepEco,
    new_warehouses: warehouses.slice(K0).map((w) => w.warehouse_id),
    abandoned_infra: [],
    sold_vehicles: [],
  }];
  if (policy.allow_sell_vehicles && policy.resale_value > 0) {
    const eco = score(metrics, 0, policy.resale_value);
    ranked.push({
      plan: `keep-all + ${K_total - K0} new site(s) + sell vehicles`, ...eco,
      new_warehouses: warehouses.slice(K0).map((w) => w.warehouse_id),
      abandoned_infra: [], sold_vehicles: ['owned fleet resale'],
    });
  }
  ranked.sort((x, y) => y.npv - x.npv);
  const winner = ranked[0];
  return {
    result,
    new_warehouse_ids: warehouses.slice(K0).map((w) => w.warehouse_id),
    relief: warehouses.slice(0, K0).map((w) => {
      const bb = beforeLoad.get(w.warehouse_id) ?? 0;
      const aa = w.assigned_orders || 0;
      return { warehouse_id: w.warehouse_id, before_orders: bb, after_orders: aa, orders_reduced: bb - aa, pct_reduced: +(((bb - aa) / Math.max(1, bb)) * 100).toFixed(1) };
    }),
    added: K_total - K0,
    policy,
    recommendation: {
      recommended_plan: {
        new_warehouses: winner.new_warehouses,
        added_vehicles: [],
        abandoned_infra: winner.abandoned_infra,
        sold_vehicles: winner.sold_vehicles,
      },
      ranked_options: ranked,
      rationale: `${winner.plan} wins on ${horizon}-month NPV (${winner.npv.toLocaleString()}): delivery saved ${winner.delivery_saved.toLocaleString()}, revenue ${winner.revenue.toLocaleString()}, capex ${winner.infra.toLocaleString()} (offline estimate).`,
    }
  };
}

async function expandNetworkClient(
  neighborhoods: Neighborhood[],
  warehouses: Warehouse[],
  addCount: number,
  config: OptimizationConfig,
  before: OptimizationResult,
  policy: ExpansionPolicy
): Promise<{ data: ExpansionResponse; live: boolean }> {
  try {
    const res = await fetch(`${API_BASE}/expand`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        neighborhoods,
        warehouses,
        add_count: addCount,
        config,
        policy,
        // Owned-fleet rows (Phase-A VehicleType shape) as the keep/sell basis; [] until onboarding lands.
        owned_vehicles: config.vehicle_fleet || [],
      })
    });
    if (res.ok) return { data: (await res.json()) as ExpansionResponse, live: true };
  } catch { /* offline → local fallback */ }
  return { data: localExpand(neighborhoods, warehouses, addCount, config, before, policy), live: false };
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
  // Phase-E policy toggles: keep vs abandon/change/demolish infra, keep vs sell vehicles, horizon + revenue.
  const [policy, setPolicy] = useState<ExpansionPolicy>(DEFAULT_EXPANSION_POLICY);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const setP = (patch: Partial<ExpansionPolicy>) => setPolicy((p) => ({ ...p, ...patch }));

  // A fresh optimization run invalidates any preview built off the old layout.
  useEffect(() => {
    setPreview(null);
    setConfirming(false);
    setAppliedK(null);
    setTarget(before.warehouses.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [before]);

  const mode: ResizeMode | null = target > K0 ? 'add' : target < K0 ? 'reduce' : null;
  const policyKey = JSON.stringify(policy);
  const stale = !!preview && (preview.target !== target);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const policyStale = !!preview && preview.mode === 'add' && (preview as any).policyKey !== policyKey;

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
          neighborhoods, before.warehouses, target - K0, before.config, before, policy
        );
        setPreview({
          mode, after: data.result, target,
          newIds: data.new_warehouse_ids, removedIds: [],
          relief: data.relief, live,
          policyKey: JSON.stringify(policy),
          recommendation: data.recommendation
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
    onApply(displayAfter || preview.after);
    setAppliedK(preview.target);
    setConfirming(false);
  };

  const recommended = preview?.mode === 'add' ? preview.recommendation : undefined;
  const winnerPlan = recommended && recommended.ranked_options.length > 0 ? recommended.ranked_options[0] : null;
  /** Before/after map + deltas follow the WINNING plan (abandon layouts drop a site). */
  const displayAfter: OptimizationResult | null = (() => {
    if (!preview) return null;
    const layouts = (preview.recommendation as any)?.layouts as
      Record<string, { warehouses: Warehouse[]; assignments: Assignment[]; metrics: any }> | undefined;
    if (preview.mode === 'add' && winnerPlan && layouts && layouts[winnerPlan.plan]) {
      const L = layouts[winnerPlan.plan];
      return { ...preview.after, warehouses: L.warehouses, assignments: L.assignments, metrics: L.metrics };
    }
    return preview.after;
  })();

  const delta = displayAfter ? layoutDelta(before, displayAfter) : null;
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

      {/* Expansion policy toggles (Phase E #11): flip these and preview again — the recommendation re-ranks. */}
      <div className="rounded-2xl border border-[#E4E1D2] bg-cream-deep/60 p-3.5 space-y-2.5">
        <div className="text-[11px] font-bold uppercase tracking-wider text-ink">Expansion policy</div>
        <label className="flex items-center gap-2 text-xs text-ink-soft cursor-pointer">
          <input
            type="checkbox"
            checked={policy.allow_abandon_infra}
            onChange={(e) => setP({ allow_abandon_infra: e.target.checked })}
            className="rounded text-[#14424E]"
          />
          OK to abandon / change / demolish current warehouse infra
        </label>
        <label className="flex items-center gap-2 text-xs text-ink-soft cursor-pointer">
          <input
            type="checkbox"
            checked={policy.allow_sell_vehicles}
            onChange={(e) => setP({ allow_sell_vehicles: e.target.checked })}
            className="rounded text-[#14424E]"
          />
          OK to sell already-owned vehicles
        </label>
        <div className="grid grid-cols-2 gap-2.5">
          <label className="text-xs text-ink-soft">
            <span className="block text-[10px] font-semibold text-ink-faint mb-1">Horizon (months)</span>
            <input
              type="number"
              min={1}
              max={120}
              value={policy.horizon_months}
              onChange={(e) => setP({ horizon_months: Math.max(1, Math.min(120, Number(e.target.value) || 12)) })}
              className="w-full bg-white border border-[#E4E1D2] rounded-lg px-2 py-1 text-xs font-mono"
            />
          </label>
          <label className="text-xs text-ink-soft">
            <span className="block text-[10px] font-semibold text-ink-faint mb-1">Revenue / order</span>
            <input
              type="number"
              min={0}
              step="0.5"
              value={policy.revenue_per_order}
              onChange={(e) => setP({ revenue_per_order: Math.max(0, Number(e.target.value) || 0) })}
              className="w-full bg-white border border-[#E4E1D2] rounded-lg px-2 py-1 text-xs font-mono"
            />
          </label>
        </div>
        <button
          onClick={() => setShowAdvanced((s) => !s)}
          className="text-[11px] font-semibold text-[#14424E] hover:underline cursor-pointer"
        >
          {showAdvanced ? 'Hide demolition / salvage / resale' : 'Demolition / salvage / resale…'}
        </button>
        {showAdvanced && (
          <div className="grid grid-cols-3 gap-2.5">
            {([
              ['demolition_cost', 'Demolition'],
              ['salvage_value', 'Salvage'],
              ['resale_value', 'Resale'],
            ] as const).map(([key, label]) => (
              <label key={key} className="text-xs text-ink-soft">
                <span className="block text-[10px] font-semibold text-ink-faint mb-1">{label}</span>
                <input
                  type="number"
                  min={0}
                  step="50"
                  value={policy[key]}
                  onChange={(e) => setP({ [key]: Math.max(0, Number(e.target.value) || 0) } as Partial<ExpansionPolicy>)}
                  className="w-full bg-white border border-[#E4E1D2] rounded-lg px-2 py-1 text-xs font-mono"
                />
              </label>
            ))}
          </div>
        )}
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
          {policyStale && (
            <div className="p-2.5 bg-gold-50 border border-gold-200 rounded-xl text-[11px] text-ink-soft">
              Policy changed — this preview used the previous toggles. Hit preview again to re-rank the recommendation.
            </div>
          )}
          <div className="p-3 bg-cream-deep/70 border border-[#E4E1D2] rounded-2xl text-xs text-ink-soft">
            {preview.mode === 'add' ? (
              <><span className="font-bold text-ink">✨ {preview.newIds.join(', ')}</span> added (K {K0} → {preview.target})</>
            ) : (
              <><span className="font-bold text-ink">➖ consolidated to K={preview.target}</span> (re-planned{preview.removedIds.length ? `, retired ${preview.removedIds.join(', ')}` : ''})</>
            )}
            {delta && displayAfter && (
              <> · avg {before.metrics.avg_distance_per_order_km} → {displayAfter.metrics.avg_distance_per_order_km} km ·{' '}
              <span className="font-bold text-[#14424E]">
                {delta.costSaved >= 0 ? '−' : '+'}{Math.abs(delta.pctCost)}% cost (${Math.abs(delta.costSaved).toLocaleString()})
              </span></>
            )}
            {offline && <span className="text-ink-faint"> · offline estimate</span>}
          </div>

          {/* ONE ranked recommendation by horizon NPV (Phase E #11) */}
          {recommended && winnerPlan && (
            <div className="rounded-2xl border border-[#14424E]/30 bg-[#14424E]/5 p-3.5 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-extrabold text-ink uppercase tracking-wider">Recommended approach</span>
                <span className="px-2.5 py-1 rounded-full bg-[#14424E] text-white text-[11px] font-extrabold">
                  NPV {winnerPlan.npv.toLocaleString()}
                </span>
              </div>
              <p className="text-[11px] font-bold text-ink">{winnerPlan.plan}</p>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[11px] border-collapse">
                  <thead>
                    <tr className="text-ink-faint uppercase tracking-wider">
                      <th className="py-1 pr-2">Option</th>
                      <th className="py-1 pr-2 text-right">NPV</th>
                      <th className="py-1 pr-2 text-right">Delivery saved</th>
                      <th className="py-1 pr-2 text-right">Revenue</th>
                      <th className="py-1 pr-2 text-right">Infra</th>
                      <th className="py-1 text-right">Fuel</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#14424E]/10 font-mono">
                    {recommended.ranked_options.map((o, i) => (
                      <tr key={o.plan} className={i === 0 ? 'font-bold text-ink' : 'text-ink-soft'}>
                        <td className="py-1 pr-2 font-sans">{i === 0 ? '★ ' : ''}{o.plan}</td>
                        <td className="py-1 pr-2 text-right">{o.npv.toLocaleString()}</td>
                        <td className="py-1 pr-2 text-right">{o.delivery_saved.toLocaleString()}</td>
                        <td className="py-1 pr-2 text-right">{o.revenue.toLocaleString()}</td>
                        <td className="py-1 pr-2 text-right">{o.infra.toLocaleString()}</td>
                        <td className="py-1 text-right">{o.fuel.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-[11px] text-ink-soft leading-relaxed">{recommended.rationale}</p>
            </div>
          )}

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

          {displayAfter && (
          <BeforeAfterCompare
            neighborhoods={neighborhoods}
            before={before}
            after={displayAfter}
            afterCaption={`After · K=${displayAfter.warehouses.length} · $${displayAfter.metrics.total_cost.toLocaleString()}`}
            deltaNote={deltaNote}
            zoneColors={zoneColors}
          />
          )}

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
