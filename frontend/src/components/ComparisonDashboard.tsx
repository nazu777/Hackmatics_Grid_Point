import React, { useMemo } from 'react';
import { Download, TrendingDown, DollarSign, Route } from 'lucide-react';
import { Neighborhood, OptimizationResult, ZoneColorMap } from '../types';
import { WarehouseExpansion } from './WarehouseExpansion';
import { TradeoffElbow } from './TradeoffElbow';

interface Props {
  result: OptimizationResult;
  /** When provided, show the incremental "add warehouses" card + before/after map slider. */
  neighborhoods?: Neighborhood[];
  zoneColors?: ZoneColorMap;
  /** Called with the final layout after user confirms — parent applies it to the main map. */
  onApply?: (result: OptimizationResult) => void;
  /** Called when the elbow view recommends a K — parent re-optimizes. */
  onSelectK?: (k: number) => void;
}

/** Render a metric value, or an explained em-dash when genuinely absent (never blank). */
function metricCell(value: number | null | undefined, format: (v: number) => React.ReactNode, absentTip: string): React.ReactNode {
  if (value === null || value === undefined || (typeof value === 'number' && isNaN(value))) {
    return (
      <span title={absentTip} className="cursor-help text-ink-faint">
        — <span className="text-[9px] align-super">?</span>
      </span>
    );
  }
  return format(value);
}

export const ComparisonDashboard: React.FC<Props> = ({ result, neighborhoods, zoneColors = {}, onApply, onSelectK }) => {
  const comp = result.comparison;
  const totalOrders = useMemo(
    () => (neighborhoods ?? []).reduce((s, n) => s + (Number(n.daily_orders) || 0), 0),
    [neighborhoods]
  );
  const avgCostPerOrder = (total: number) => (totalOrders > 0 ? total / totalOrders : 0);
  const rows = useMemo(() => {
    if (!comp) return [];
    const b = comp.baseline.metrics;
    const o = comp.optimized.metrics;
    const defs: [string, number | null | undefined, number | null | undefined, string?][] = [
      ['Total unweighted distance (km)', b.total_unweighted_distance_km, o.total_unweighted_distance_km],
      ['Total weighted distance (km·orders)', b.total_weighted_distance_km_orders, o.total_weighted_distance_km_orders],
      ['Total delivery cost ($)', b.total_cost, o.total_cost],
      ['Fuel cost portion ($)', b.total_fuel_cost, o.total_fuel_cost, 'No fuel data for this layout (rates unreachable and no manual surcharge set)'],
      ['Avg corridor congestion', b.avg_congestion_pct, o.avg_congestion_pct, 'No corridor congestion observed (traffic off, no history yet)'],
      ['Avg distance / order (km)', b.avg_distance_per_order_km, o.avg_distance_per_order_km],
      ['Avg weighted distance (km)', b.avg_weighted_distance_km, o.avg_weighted_distance_km],
      ['Avg cost / order ($)', totalOrders > 0 ? b.total_cost / totalOrders : null, totalOrders > 0 ? o.total_cost / totalOrders : null, 'No order volume to average over'],
      ['Feasibility ratio', b.feasibility_ratio, o.feasibility_ratio, 'Feasibility unknown (no assignments evaluated)']
    ];
    return defs.map(([label, baseline, optimized, absentTip]) => ({
      label,
      baseline,
      optimized,
      absentTip: absentTip || 'Not reported for this layout',
      saved: baseline != null && optimized != null ? +(baseline - optimized).toFixed(2) : null,
      pct: baseline ? +(((baseline - (optimized ?? 0)) / baseline) * 100).toFixed(2) : 0
    }));
  }, [comp, totalOrders]);

  /** Per-node optimized-vs-older-way truth table (Phase D #7): every row shows road km + fuel + cost. */
  const nodeRows = useMemo(() => {
    if (!comp) return [];
    const baseById = new Map(comp.baseline.assignments.map((a) => [a.neighborhood_id, a]));
    const ordersById = new Map((neighborhoods ?? []).map((n) => [n.neighborhood_id, Number(n.daily_orders) || 0]));
    return comp.optimized.assignments.map((a) => {
      const b = baseById.get(a.neighborhood_id);
      const w = ordersById.get(a.neighborhood_id) ?? (a.distance_km > 0 ? Math.round(a.weighted_distance / a.distance_km) : 0);
      const avg = (c: number) => (w > 0 ? c / w : c);
      return {
        id: a.neighborhood_id,
        warehouse: a.warehouse_id,
        orders: w,
        bDist: b?.distance_km ?? null,
        bFuel: b?.fuel_cost ?? null,
        bCost: b?.cost ?? null,
        bAvg: b ? avg(b.cost) : null,
        oDist: a.distance_km,
        oFuel: a.fuel_cost ?? 0,
        oCost: a.cost,
        oAvg: avg(a.cost),
        saved: b ? b.cost - a.cost : null,
      };
    });
  }, [comp, neighborhoods]);

  const hist = useMemo(() => {
    const vals = result.assignments.map((a) => a.distance_km);
    if (!vals.length) return [];
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    const bins = 10;
    if (hi <= lo) return [{ label: `${lo.toFixed(1)} km`, count: vals.length }];
    const w = (hi - lo) / bins;
    return Array.from({ length: bins }, (_, b) => {
      const s = lo + b * w;
      const e = b === bins - 1 ? hi : s + w;
      const count = vals.filter((v) => (v >= s && v < e) || (b === bins - 1 && v === hi)).length;
      return { label: `${s.toFixed(1)}–${e.toFixed(1)}`, count };
    });
  }, [result.assignments]);

  const maxBin = Math.max(1, ...hist.map((h) => h.count));

  const download = (filename: string, text: string, mime = 'text/csv') => {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const el = document.createElement('a');
    el.href = url;
    el.download = filename;
    el.click();
    URL.revokeObjectURL(url);
  };

  const API_BASE = (import.meta.env.VITE_API_URL as string) || '/api';

  const localMetricsCsv = () => {
    const lines = ['metric,baseline,optimized,saved,pct_saved'];
    rows.forEach((r) => lines.push(`"${r.label}",${r.baseline ?? ''},${r.optimized ?? ''},${r.saved ?? ''},${r.pct}`));
    lines.push('');
    lines.push('warehouse_id,assigned_orders,utilization_pct,avg_distance_km,neighborhood_count');
    result.metrics.warehouses.forEach((w) =>
      lines.push(`${w.warehouse_id},${w.assigned_orders},${w.utilization_pct},${w.avg_distance_km},${w.neighborhood_count}`)
    );
    return lines.join('\n');
  };

  const localAssignmentsCsv = () => {
    const lines = ['neighborhood_id,warehouse_id,distance_km,weighted_distance,fuel_cost,cost,avg_cost_per_order,within_radius,is_feasible'];
    result.assignments.forEach((a) => {
      const w = a.distance_km > 0 ? Math.round(a.weighted_distance / a.distance_km) : 0;
      const avg = w > 0 ? (a.cost / w).toFixed(2) : a.cost.toFixed(2);
      lines.push(`${a.neighborhood_id},${a.warehouse_id},${a.distance_km},${a.weighted_distance},${a.fuel_cost ?? 0},${a.cost},${avg},${a.within_radius},${a.is_feasible}`);
    });
    return lines.join('\n');
  };

  const exportMetrics = async () => {
    try {
      const res = await fetch(`${API_BASE}/export/metrics`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ result })
      });
      if (res.ok) {
        download('gridpoint_metrics_comparison.csv', await res.text());
        return;
      }
    } catch { /* offline → local CSV below */ }
    download('gridpoint_metrics_comparison.csv', localMetricsCsv());
  };

  const exportAssignments = async () => {
    try {
      const res = await fetch(`${API_BASE}/export/assignments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ result })
      });
      if (res.ok) {
        download('gridpoint_assignments.csv', await res.text());
        return;
      }
    } catch { /* offline → local CSV below */ }
    download('gridpoint_assignments.csv', localAssignmentsCsv());
  };

  if (!comp) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-3xl p-5 text-xs text-amber-800">
        No baseline comparison in this result — re-run optimization.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Side-by-side cards */}
      <div className="card p-5">
        <h3 className="font-bold text-sm text-ink mb-4">Original vs Optimized</h3>
        <div className="grid grid-cols-1 gap-3">
          {[
            {
              icon: Route,
              label: 'Distance saved',
              value: `${comp.delta.pct_distance_saved}%`,
              sub: `${comp.delta.weighted_distance_saved.toLocaleString()} km·orders • ${comp.delta.distance_saved_km.toLocaleString()} km`
            },
            {
              icon: DollarSign,
              label: 'Cost reduction',
              value: `${comp.delta.pct_cost_saved}%`,
              sub: `$${comp.delta.cost_saved.toLocaleString()} saved • Baseline $${comp.baseline.metrics.total_cost.toLocaleString()} → $${comp.optimized.metrics.total_cost.toLocaleString()}`
            },
            {
              icon: TrendingDown,
              label: 'Avg / order',
              value: totalOrders > 0 ? `$${avgCostPerOrder(result.metrics.total_cost).toFixed(2)} • ${result.metrics.avg_distance_per_order_km} km` : `${result.metrics.avg_distance_per_order_km} km`,
              sub: totalOrders > 0
                ? `Baseline $${avgCostPerOrder(comp.baseline.metrics.total_cost).toFixed(2)} • ${comp.baseline.metrics.avg_distance_per_order_km} km • Feasibility ${result.metrics.feasibility_ratio != null ? `${(result.metrics.feasibility_ratio * 100).toFixed(1)}%` : '—'}`
                : `Feasibility ${result.metrics.feasibility_ratio != null ? `${(result.metrics.feasibility_ratio * 100).toFixed(1)}%` : '—'}`
            }
          ].map((s) => {
            const Icon = s.icon;
            return (
              <div key={s.label} className="panel-well p-4 flex items-center gap-3">
                <span className="w-10 h-10 rounded-full bg-white flex items-center justify-center text-ink shrink-0 border border-[#E4E1D2]">
                  <Icon className="w-5 h-5" />
                </span>
                <span className="min-w-0">
                  <span className="block text-[11px] font-bold uppercase tracking-wider text-ink-faint">
                    {s.label}
                  </span>
                  <span className="block text-[22px] font-extrabold text-ink leading-tight">
                    {s.value}
                  </span>
                  <span className="block text-[11px] text-ink-faint truncate">{s.sub}</span>
                </span>
              </div>
            );
          })}
        </div>

        {/* Fuel reduction graph: total cost split into fuel vs non-fuel */}
        {(() => {
          const b = comp.baseline.metrics;
          const o = comp.optimized.metrics;
          const bFuel = b.total_fuel_cost ?? 0;
          const oFuel = o.total_fuel_cost ?? 0;
          const bBase = Math.max(0, b.total_cost - bFuel);
          const oBase = Math.max(0, o.total_cost - oFuel);
          const max = Math.max(1, b.total_cost, o.total_cost);
          const fuelSaved = Math.max(0, bFuel - oFuel);
          const bar = (total: number, fuel: number, base: number) => (
            <div className="flex-1">
              <div className="flex h-24 rounded-xl overflow-hidden border border-[#E4E1D2]">
                <div
                  className="bg-[#14424E]/85 flex items-end justify-center pb-1"
                  style={{ width: `${(base / max) * 100}%` }}
                  title={`Non-fuel: $${base.toLocaleString()}`}
                />
                <div
                  className="bg-amber-400/90 flex items-end justify-center pb-1"
                  style={{ width: `${(fuel / max) * 100}%` }}
                  title={`Fuel: $${fuel.toLocaleString()}`}
                />
              </div>
              <div className="text-center mt-1.5">
                <div className="font-mono font-bold text-sm text-ink">${total.toLocaleString()}</div>
              </div>
            </div>
          );
          return (
            <div className="mt-4 rounded-2xl border border-[#E4E1D2] p-4">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-bold text-ink uppercase tracking-wider">⛽ Fuel cost reduction</span>
                <span className="text-[11px] font-mono text-[#14424E] font-bold">
                  −${fuelSaved.toLocaleString()} fuel ({o.total_fuel_cost != null && b.total_fuel_cost ? `${(((bFuel - oFuel) / Math.max(1, bFuel)) * 100).toFixed(1)}%` : '—'})
                </span>
              </div>
              <div className="flex gap-4">
                <div className="flex-1">
                  <div className="text-[10px] font-semibold text-ink-faint mb-1 text-center">BASELINE</div>
                  {bar(b.total_cost, bFuel, bBase)}
                </div>
                <div className="flex-1">
                  <div className="text-[10px] font-semibold text-ink-faint mb-1 text-center">OPTIMIZED</div>
                  {bar(o.total_cost, oFuel, oBase)}
                </div>
              </div>
              <div className="flex items-center justify-center gap-4 mt-2 text-[10px] text-ink-faint">
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-[#14424E]/85 inline-block" /> Non-fuel delivery</span>
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-amber-400/90 inline-block" /> Fuel portion</span>
                <span>Each node repriced at {result.fuel_note || 'configured rates'}</span>
              </div>
            </div>
          );
        })()}

        {/* Fuel provenance line */}
        <p className="text-[11px] text-slate-500 mt-3">
          ⛽ Fuel portion:{' '}
          {metricCell(result.metrics.total_fuel_cost, (v) => <span>${v.toLocaleString()}</span>, 'No fuel data for this layout (rates unreachable and no manual surcharge set)')}
          {' '}of ${result.metrics.total_cost.toLocaleString()} total
          {result.metrics.fuel_live ? ' • live pump prices' : ' • manual rates'}
          {result.fuel_note ? ` — ${result.fuel_note}` : ''}
        </p>

        {/* Full metrics table */}
        <div className="overflow-x-auto mt-3">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-cream-deep border-b border-[#E4E1D2] text-ink-faint uppercase tracking-wider">
                <th className="py-2.5 px-4">Metric</th>
                <th className="py-2.5 px-4 text-right">Baseline</th>
                <th className="py-2.5 px-4 text-right">Optimized</th>
                <th className="py-2.5 px-4 text-right">Saved</th>
                <th className="py-2.5 px-4 text-right">% Saved</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.label} className="hover:bg-cream-deep">
                  <td className="py-2 px-4 font-medium text-ink-soft">{r.label}</td>
                  <td className="py-2 px-4 text-right font-mono text-ink-faint">{metricCell(r.baseline, (v) => <span>{v.toLocaleString()}</span>, r.absentTip)}</td>
                  <td className="py-2 px-4 text-right font-mono font-bold text-ink">{metricCell(r.optimized, (v) => <span>{v.toLocaleString()}</span>, r.absentTip)}</td>
                  <td className="py-2 px-4 text-right font-mono text-ink-soft">{metricCell(r.saved, (v) => <span>{v.toLocaleString()}</span>, r.absentTip)}</td>
                  <td className="py-2 px-4 text-right font-mono text-ink">{r.pct}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Per-node optimized vs older-way truth (Phase D #7): road km + fuel + cost per row */}
      {nodeRows.length > 0 && (
        <div className="card p-5">
          <h3 className="font-bold text-sm text-ink mb-1">Per-node cost truth — older way vs optimized</h3>
          <p className="text-[11px] text-ink-faint mb-3">
            Every row prices the same orders on road distance × fuel price/mileage. Baseline = your existing warehouses (centroid fallback).
          </p>
          <div className="overflow-x-auto max-h-96 overflow-y-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="sticky top-0">
                <tr className="bg-cream-deep border-b border-[#E4E1D2] text-ink-faint uppercase tracking-wider">
                  <th className="py-2 px-3">Node</th>
                  <th className="py-2 px-3 text-right">Orders</th>
                  <th className="py-2 px-3 text-right">Base km</th>
                  <th className="py-2 px-3 text-right">Base fuel</th>
                  <th className="py-2 px-3 text-right">Base cost</th>
                  <th className="py-2 px-3 text-right">Opt km</th>
                  <th className="py-2 px-3 text-right">Opt fuel</th>
                  <th className="py-2 px-3 text-right">Opt cost</th>
                  <th className="py-2 px-3 text-right">Avg/order</th>
                  <th className="py-2 px-3 text-right">Saved</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {nodeRows.map((r) => (
                  <tr key={r.id} className="hover:bg-cream-deep">
                    <td className="py-1.5 px-3 font-medium text-ink-soft">{r.id} <span className="text-ink-faint">→ {r.warehouse}</span></td>
                    <td className="py-1.5 px-3 text-right font-mono">{r.orders.toLocaleString()}</td>
                    <td className="py-1.5 px-3 text-right font-mono text-ink-faint">{r.bDist != null ? r.bDist.toLocaleString() : '—'}</td>
                    <td className="py-1.5 px-3 text-right font-mono text-ink-faint">{r.bFuel != null ? `$${r.bFuel.toLocaleString()}` : '—'}</td>
                    <td className="py-1.5 px-3 text-right font-mono text-ink-faint">{r.bCost != null ? `$${r.bCost.toLocaleString()}` : '—'}</td>
                    <td className="py-1.5 px-3 text-right font-mono font-bold text-ink">{r.oDist.toLocaleString()}</td>
                    <td className="py-1.5 px-3 text-right font-mono text-ink">${r.oFuel.toLocaleString()}</td>
                    <td className="py-1.5 px-3 text-right font-mono font-bold text-ink">${r.oCost.toLocaleString()}</td>
                    <td className="py-1.5 px-3 text-right font-mono text-ink-soft">${r.oAvg.toFixed(2)}</td>
                    <td className="py-1.5 px-3 text-right font-mono text-[#14424E]">{r.saved != null ? `$${r.saved.toFixed(2)}` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Infra-vs-delivery elbow (Phase D #10) */}
      {neighborhoods && neighborhoods.length > 0 && (
        <TradeoffElbow neighborhoods={neighborhoods} config={result.config} maxK={Math.max(3, Math.min(8, neighborhoods.length))} onSelectK={onSelectK} />
      )}

      {/* Incremental expansion: add warehouses + before/after map slider */}
      {neighborhoods && neighborhoods.length > 0 && (
        <WarehouseExpansion neighborhoods={neighborhoods} before={result} zoneColors={zoneColors} onApply={onApply} />
      )}

      {/* Distance distribution */}
      <div className="card p-5">
        <h3 className="font-bold text-sm text-ink mb-1">📊 Distance Distribution (optimized, km)</h3>
        <p className="text-[11px] text-ink-faint mb-4">Histogram of neighborhood→warehouse distances; verifies map lines match assignment table.</p>
        <div className="flex items-end gap-1.5 h-32">
          {hist.map((h, i) => (
            <div key={i} className="flex-1 flex flex-col items-center gap-1" title={`${h.label} km: ${h.count}`}>
              <span className="text-[10px] font-mono text-ink-faint">{h.count}</span>
              <div className="w-full rounded-t-md bg-[#14424E]/80 hover:bg-[#14424E] transition" style={{ height: `${Math.max(4, (h.count / maxBin) * 90)}px` }} />
              <span className="text-[9px] font-mono text-ink-faint hidden">{h.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Exports */}
      <div className="card p-5 flex flex-wrap gap-3">
        <button onClick={exportMetrics} className="flex items-center gap-2 px-4 py-2 bg-[#14424E] hover:bg-[#0d333d] text-white rounded-full text-xs font-bold transition cursor-pointer">
          <Download className="w-4 h-4" /> Metrics Table (CSV)
        </button>
        <button onClick={exportAssignments} className="flex items-center gap-2 px-4 py-2 bg-white border border-[#E4E1D2] hover:bg-cream-deep text-ink rounded-full text-xs font-bold transition cursor-pointer">
          <Download className="w-4 h-4" /> Assignments (CSV)
        </button>
      </div>
    </div>
  );
};
