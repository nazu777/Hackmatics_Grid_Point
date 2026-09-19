import React, { useMemo } from 'react';
import { Scale, Download, TrendingDown, DollarSign, Route } from 'lucide-react';
import { OptimizationResult } from '../types';

interface Props {
  result: OptimizationResult;
}

export const ComparisonDashboard: React.FC<Props> = ({ result }) => {
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
    const lines = ['neighborhood_id,warehouse_id,distance_km,weighted_distance,cost,within_radius,is_feasible'];
    result.assignments.forEach((a) =>
      lines.push(`${a.neighborhood_id},${a.warehouse_id},${a.distance_km},${a.weighted_distance},${a.cost},${a.within_radius},${a.is_feasible}`)
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
    <div className="space-y-6">
      {/* Side-by-side cards */}
      <div className="card p-5">
        <h3 className="font-bold text-sm text-ink mb-4 flex items-center gap-2">
          <Scale className="w-4 h-4 text-grape-500" /> Original vs Optimized — Side-by-Side
        </h3>
        <div className="grid grid-cols-1 gap-3">
          <div className="bg-cream-deep border border-[#E4E1D2] p-5 rounded-2xl">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-[#14424E] uppercase tracking-wider">Distance Saved</span>
              <Route className="w-5 h-5 text-[#14424E]" />
            </div>
            <h4 className="text-3xl font-extrabold text-ink mt-2">{comp.delta.pct_distance_saved}%</h4>
            <p className="text-xs text-ink-soft mt-1">{comp.delta.weighted_distance_saved.toLocaleString()} km·orders • {comp.delta.distance_saved_km.toLocaleString()} km</p>
          </div>
          <div className="p-5 rounded-2xl bg-grape-100/70 border border-grape-200">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-grape-600 uppercase tracking-wider">Cost Reduction</span>
              <DollarSign className="w-5 h-5 text-grape-500" />
            </div>
            <h4 className="text-3xl font-extrabold text-ink mt-2">{comp.delta.pct_cost_saved}%</h4>
            <p className="text-xs text-ink-soft mt-1">${comp.delta.cost_saved.toLocaleString()} saved • Baseline ${comp.baseline.metrics.total_cost.toLocaleString()} → ${comp.optimized.metrics.total_cost.toLocaleString()}</p>
          </div>
          <div className="p-5 rounded-2xl bg-gold-100/60 border border-gold-200">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-gold-600 uppercase tracking-wider">Avg / Order</span>
              <TrendingDown className="w-5 h-5 text-gold-500" />
            </div>
            <h4 className="text-3xl font-extrabold text-ink mt-2">{result.metrics.avg_distance_per_order_km} km</h4>
            <p className="text-xs text-ink-soft mt-1">Baseline was {comp.baseline.metrics.avg_distance_per_order_km} km • Feasibility {(result.metrics.feasibility_ratio * 100).toFixed(1)}%</p>
          </div>
        </div>

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
              <tr className="bg-cream-deep/60 border-b border-[#E4E1D2] text-ink-faint uppercase tracking-wider">
                <th className="py-2.5 px-4">Metric</th>
                <th className="py-2.5 px-4 text-right">Baseline</th>
                <th className="py-2.5 px-4 text-right">Optimized</th>
                <th className="py-2.5 px-4 text-right">Saved</th>
                <th className="py-2.5 px-4 text-right">% Saved</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.label} className="hover:bg-cream-deep/60">
                  <td className="py-2 px-4 font-medium text-ink-soft">{r.label}</td>
                  <td className="py-2 px-4 text-right font-mono text-ink-faint">{r.baseline.toLocaleString()}</td>
                  <td className="py-2 px-4 text-right font-mono font-bold text-[#14424E]">{r.optimized.toLocaleString()}</td>
                  <td className="py-2 px-4 text-right font-mono text-ink-soft">{r.saved.toLocaleString()}</td>
                  <td className="py-2 px-4 text-right font-mono text-[#14424E]">{r.pct}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

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
