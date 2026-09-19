import React from 'react';
import { FileDown, Table2, Map as MapIcon, Database, ReceiptText } from 'lucide-react';
import type { Neighborhood, OptimizationResult } from '../types';
import { exportCsv, exportJson } from '../services/api';

interface ExportViewProps {
  neighborhoods: Neighborhood[];
  result: OptimizationResult | null;
}

function download(filename: string, text: string, mime = 'text/csv') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const el = document.createElement('a');
  el.href = url;
  el.download = filename;
  el.click();
  URL.revokeObjectURL(url);
}

export const ExportView: React.FC<ExportViewProps> = ({ neighborhoods, result }) => {
  const handleDatasetCsv = async () => download('gridpoint_neighborhoods.csv', await exportCsv(neighborhoods));
  const handleDatasetJson = async () =>
    download('gridpoint_neighborhoods.json', await exportJson(neighborhoods), 'application/json');

  const handleMetricsCsv = () => {
    if (!result?.comparison) return;
    const b = result.comparison.baseline.metrics;
    const o = result.comparison.optimized.metrics;
    const rows: [string, number, number][] = [
      ['total_unweighted_distance_km', b.total_unweighted_distance_km, o.total_unweighted_distance_km],
      ['total_weighted_distance_km_orders', b.total_weighted_distance_km_orders, o.total_weighted_distance_km_orders],
      ['total_cost', b.total_cost, o.total_cost],
      ['avg_distance_per_order_km', b.avg_distance_per_order_km, o.avg_distance_per_order_km],
      ['avg_weighted_distance_km', b.avg_weighted_distance_km, o.avg_weighted_distance_km],
      ['feasibility_ratio', b.feasibility_ratio, o.feasibility_ratio]
    ];
    const lines = ['metric,baseline,optimized,saved,pct_saved'];
    rows.forEach(([name, bv, ov]) => {
      const saved = +(bv - ov).toFixed(2);
      const pct = bv ? +(((bv - ov) / bv) * 100).toFixed(2) : 0;
      lines.push(`${name},${bv},${ov},${saved},${pct}`);
    });
    lines.push('');
    lines.push('warehouse_id,assigned_orders,utilization_pct,avg_distance_km,neighborhood_count');
    result.metrics.warehouses.forEach((w) =>
      lines.push(`${w.warehouse_id},${w.assigned_orders},${w.utilization_pct},${w.avg_distance_km},${w.neighborhood_count}`)
    );
    download('gridpoint_metrics_comparison.csv', lines.join('\n'));
  };

  const handleAssignmentsCsv = () => {
    if (!result) return;
    const lines = ['neighborhood_id,warehouse_id,distance_km,weighted_distance,cost,within_radius,is_feasible'];
    result.assignments.forEach((a) =>
      lines.push(`${a.neighborhood_id},${a.warehouse_id},${a.distance_km},${a.weighted_distance},${a.cost},${a.within_radius},${a.is_feasible}`)
    );
    download('gridpoint_assignments.csv', lines.join('\n'));
  };

  const handleGeoJson = () => {
    const features: unknown[] = neighborhoods.map((n) => ({
      type: 'Feature',
      properties: {
        kind: 'neighborhood',
        neighborhood_id: n.neighborhood_id,
        name: n.name,
        daily_orders: n.daily_orders,
        zone: n.zone
      },
      geometry: { type: 'Point', coordinates: [n.longitude, n.latitude] }
    }));
    (result?.warehouses ?? []).forEach((w) =>
      features.push({
        type: 'Feature',
        properties: { kind: 'warehouse', warehouse_id: w.warehouse_id },
        geometry: { type: 'Point', coordinates: [w.longitude, w.latitude] }
      })
    );
    download('gridpoint_map.geojson', JSON.stringify({ type: 'FeatureCollection', features }, null, 2), 'application/json');
  };

  const cards = [
    {
      icon: Database,
      title: 'Neighborhood Dataset (CSV)',
      desc: `${neighborhoods.length} demand nodes in canonical schema.`,
      action: handleDatasetCsv,
      enabled: neighborhoods.length > 0
    },
    {
      icon: Table2,
      title: 'Neighborhood Dataset (JSON)',
      desc: 'Same dataset as formatted JSON.',
      action: handleDatasetJson,
      enabled: neighborhoods.length > 0
    },
    {
      icon: ReceiptText,
      title: 'Metrics Comparison (CSV)',
      desc: 'Baseline vs optimized side-by-side table.',
      action: handleMetricsCsv,
      enabled: !!result?.comparison
    },
    {
      icon: FileDown,
      title: 'Assignments (CSV)',
      desc: 'Every neighborhood → warehouse mapping.',
      action: handleAssignmentsCsv,
      enabled: !!result && result.assignments.length > 0
    },
    {
      icon: MapIcon,
      title: 'Map Snapshot (GeoJSON)',
      desc: 'Demand points + warehouse pins for GIS tools.',
      action: handleGeoJson,
      enabled: neighborhoods.length > 0
    }
  ];

  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-display font-semibold text-[32px] text-ink leading-tight">Export Reports ({cards.filter((c) => c.enabled).length})</h2>
        <p className="text-[13px] text-ink-faint mt-1">Download datasets, comparisons and map snapshots. Reports unlock as you progress.</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {cards.map((c) => {
          const Icon = c.icon;
          return (
            <div key={c.title} className="card p-5 flex flex-col">
              <span className="w-10 h-10 rounded-full bg-cream-deep flex items-center justify-center text-ink">
                <Icon className="w-5 h-5" />
              </span>
              <h3 className="font-bold text-[15px] text-ink mt-3">{c.title}</h3>
              <p className="text-xs text-ink-faint mt-1 flex-1">{c.desc}</p>
              <button
                onClick={c.action}
                disabled={!c.enabled}
                className={`mt-4 px-4 py-2 rounded-full text-xs font-bold transition cursor-pointer ${
                  c.enabled
                    ? 'bg-pine-700 text-white hover:bg-pine-800'
                    : 'bg-cream-deep text-ink-faint cursor-not-allowed opacity-70'
                }`}
              >
                {c.enabled ? 'Download' : 'Locked — run previous steps'}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};
