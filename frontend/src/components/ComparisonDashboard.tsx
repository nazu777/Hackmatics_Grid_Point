import React, { useMemo } from 'react';
import { Download, TrendingDown, DollarSign, Route } from 'lucide-react';
import { Neighborhood, OptimizationResult, ZoneColorMap } from '../types';
import { WarehouseExpansion } from './WarehouseExpansion';

interface Props {
  result: OptimizationResult;
  /** When provided, show the incremental "add warehouses" card + before/after map slider. */
  neighborhoods?: Neighborhood[];
  zoneColors?: ZoneColorMap;
  /** Called with the final layout after user confirms — parent applies it to the main map. */
  onApply?: (result: OptimizationResult) => void;
}

export const ComparisonDashboard: React.FC<Props> = ({ result, neighborhoods, zoneColors = {}, onApply }) => {
  const comp = result.comparison;
  const rows = useMemo(() => {
    if (!comp) return [];
    const b = comp.baseline.metrics;
    const o = comp.optimized.metrics;
    const defs: [string, number, number][] = [
      ['Total unweighted distance (km)', b.total_unweighted_distance_km, o.total_unweighted_distance_km],
      ['Total weighted distance (km·orders)', b.total_weighted_distance_km_orders, o.total_weighted_distance_km_orders],
      ['Total delivery cost ($)', b.total_cost, o.total_cost],
      ['Fuel cost portion ($)', b.total_fuel_cost ?? 0, o.total_fuel_cost ?? 0],
      ['Avg corridor congestion', b.avg_congestion_pct ?? 0, o.avg_congestion_pct ?? 0],
      ['Avg distance / order (km)', b.avg_distance_per_order_km, o.avg_distance_per_order_km],
      ['Avg weighted distance (km)', b.avg_weighted_distance_km, o.avg_weighted_distance_km],
      ['Feasibility ratio', b.feasibility_ratio, o.feasibility_ratio]
    ];
    return defs.map(([label, baseline, optimized]) => ({
      label, baseline, optimized,
      saved: +(baseline - optimized).toFixed(2),
      pct: baseline ? +(((baseline - optimized) / baseline) * 100).toFixed(2) : 0
    }));
  }, [comp]);

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

  const exportMetrics = () => {
    const lines = ['metric,baseline,optimized,saved,pct_saved'];
    rows.forEach((r) => lines.push(`"${r.label}",${r.baseline},${r.optimized},${r.saved},${r.pct}`));
    lines.push('');
    lines.push('warehouse_id,assigned_orders,utilization_pct,avg_distance_km,neighborhood_count');
    result.metrics.warehouses.forEach((w) =>
      lines.push(`${w.warehouse_id},${w.assigned_orders},${w.utilization_pct},${w.avg_distance_km},${w.neighborhood_count}`)
    );
    download('gridpoint_metrics_comparison.csv', lines.join('\n'));
  };

  const exportAssignments = () => {
    const lines = ['neighborhood_id,warehouse_id,distance_km,weighted_distance,cost,fuel_cost,within_radius,is_feasible'];
    result.assignments.forEach((a) =>
      lines.push(`${a.neighborhood_id},${a.warehouse_id},${a.distance_km},${a.weighted_distance},${a.cost},${a.fuel_cost ?? 0},${a.within_radius},${a.is_feasible}`)
    );
    download('gridpoint_assignments.csv', lines.join('\n'));
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
              value: `${result.metrics.avg_distance_per_order_km} km`,
              sub: `Baseline was ${comp.baseline.metrics.avg_distance_per_order_km} km • Feasibility ${(result.metrics.feasibility_ratio * 100).toFixed(1)}%`
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
          ⛽ Fuel portion: ${(result.metrics.total_fuel_cost ?? 0).toLocaleString()} of ${result.metrics.total_cost.toLocaleString()} total
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
                  <td className="py-2 px-4 text-right font-mono text-ink-faint">{r.baseline.toLocaleString()}</td>
                  <td className="py-2 px-4 text-right font-mono font-bold text-ink">{r.optimized.toLocaleString()}</td>
                  <td className="py-2 px-4 text-right font-mono text-ink-soft">{r.saved.toLocaleString()}</td>
                  <td className="py-2 px-4 text-right font-mono text-ink">{r.pct}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

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
