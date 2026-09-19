import React, { useMemo } from 'react';
import { Package, Truck, Route, DollarSign, TrendingUp, TrendingDown } from 'lucide-react';
import type { DatasetSummary, Neighborhood, OptimizationResult } from '../types';
import { SectionOverview } from './SectionOverview';
import { UsageDonut } from './UsageDonut';

interface DashboardProps {
  neighborhoods: Neighborhood[];
  summary: DatasetSummary;
  result: OptimizationResult | null;
  selectedWh: string | null;
  onSelectWh: (id: string) => void;
  onAddRequest: () => void;
  onEditSection: () => void;
  onDeleteResult: () => void;
  onRunOptimizer: () => void;
}

function histogram(vals: number[], bins: number, lo: number, hi: number): number[] {
  if (!vals.length || hi <= lo) return vals.length ? [vals.length] : [];
  const w = (hi - lo) / bins;
  return Array.from({ length: bins }, (_, b) => {
    const s = lo + b * w;
    return vals.filter((v) => (v >= s && (b < bins - 1 ? v < s + w : v <= hi))).length;
  });
}

const OrderBarChart: React.FC<{ result: OptimizationResult | null }> = ({ result }) => {
  const { bins, base, opt, labels } = useMemo(() => {
    if (!result?.comparison) return { bins: [], base: [] as number[], opt: [] as number[], labels: [] as string[] };
    const bVals = result.comparison.baseline.assignments.map((a) => a.distance_km);
    const oVals = result.assignments.map((a) => a.distance_km);
    const all = [...bVals, ...oVals];
    const lo = Math.min(...all);
    const hi = Math.max(...all);
    const n = 6;
    const width = hi > lo ? (hi - lo) / n : 1;
    const labels = Array.from({ length: n }, (_, i) =>
      hi > lo ? `${(lo + i * width).toFixed(0)}–${(lo + (i + 1) * width).toFixed(0)}` : 'km'
    );
    return { bins: Array.from({ length: n }, (_, i) => i), base: histogram(bVals, n, lo, hi), opt: histogram(oVals, n, lo, hi), labels };
  }, [result]);

  const max = Math.max(1, ...base, ...opt);

  return (
    <div className="card p-5 flex-1">
      <div className="flex items-center justify-between mb-1">
        <h3 className="font-display font-semibold text-[19px] text-ink">Order Statistics</h3>
        <span className="text-ink-faint text-lg leading-none tracking-widest">•••</span>
      </div>
      {!result?.comparison ? (
        <p className="text-xs text-ink-faint py-6">Distance distribution appears after optimization.</p>
      ) : (
        <>
          <div className="flex items-end gap-4 h-40 mt-2">
            {bins.map((b) => (
              <div key={b} className="flex-1 flex flex-col items-center gap-1.5 h-full justify-end">
                <div className="flex items-end gap-1.5 h-full">
                  <div
                    className="w-4 sm:w-5 rounded-t-md bg-[#14424E]"
                    style={{ height: `${Math.max(4, (base[b] / max) * 100)}%` }}
                    title={`Baseline: ${base[b]}`}
                  />
                  <div
                    className="w-4 sm:w-5 rounded-t-md bg-gold"
                    style={{ height: `${Math.max(4, (opt[b] / max) * 100)}%` }}
                    title={`Optimized: ${opt[b]}`}
                  />
                </div>
                <span className="text-[9px] font-mono text-ink-faint">{labels[b]}</span>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-4 mt-3 text-[10px] text-ink-faint">
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-[#14424E]" /> Baseline
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-gold" /> Optimized
            </span>
          </div>
        </>
      )}
    </div>
  );
};

const SavingsGauge: React.FC<{ result: OptimizationResult | null; onRun: () => void }> = ({ result, onRun }) => {
  const pct = result?.comparison?.delta.pct_cost_saved ?? 0;
  const saved = result?.comparison?.delta.cost_saved ?? 0;
  const SEGS = 18;
  const lit = Math.round((Math.min(100, Math.max(0, pct)) / 100) * SEGS);
  const cx = 110;
  const cy = 96;
  const R = 72;

  return (
    <div className="card p-5 flex-1 flex flex-col">
      <div className="flex items-center justify-between mb-1">
        <h3 className="font-display font-semibold text-[19px] text-ink">Order Summary</h3>
        <span className="text-ink-faint text-lg leading-none tracking-widest">•••</span>
      </div>
      <div className="flex-1 flex flex-col items-center justify-center">
        <svg viewBox="0 0 220 112" className="w-full max-w-[240px]">
          {Array.from({ length: SEGS }).map((_, i) => {
            const ang = (180 - (i * 180) / (SEGS - 1)) * (Math.PI / 180);
            const x1 = cx + (R - 11) * Math.cos(ang);
            const y1 = cy - (R - 11) * Math.sin(ang);
            const x2 = cx + (R + 1) * Math.cos(ang);
            const y2 = cy - (R + 1) * Math.sin(ang);
            return (
              <line
                key={i}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke={i < SEGS - lit ? '#EDEAD9' : '#F2C14E'}
                strokeWidth={9}
                strokeLinecap="round"
              />
            );
          })}
        </svg>
        <div className="text-center -mt-9">
          <div className="text-[22px] font-bold text-ink leading-none">
            {result ? `$${saved.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '—'}
          </div>
          <div className="text-[10px] text-ink-faint mt-1">Delivery Cost Saved</div>
          {result ? (
            <div className="text-[11px] font-bold text-pine-600 mt-0.5">{pct.toFixed(1)}% ↘</div>
          ) : (
            <button
              onClick={onRun}
              className="mt-2 px-4 py-1.5 rounded-full bg-pine-700 text-white text-[11px] font-bold hover:bg-pine-800 transition cursor-pointer"
            >
              Run Optimizer
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export const Dashboard: React.FC<DashboardProps> = ({
  neighborhoods,
  summary,
  result,
  selectedWh,
  onSelectWh,
  onAddRequest,
  onEditSection,
  onDeleteResult,
  onRunOptimizer
}) => {
  const feasibleOrders = useMemo(() => {
    if (!result) return summary.total_orders;
    const byId = new Map(neighborhoods.map((n) => [n.neighborhood_id, Number(n.daily_orders) || 0]));
    return result.assignments.filter((a) => a.is_feasible).reduce((s, a) => s + (byId.get(a.neighborhood_id) || 0), 0);
  }, [result, neighborhoods, summary]);

  const cards = [
    {
      icon: Package,
      value: summary.total_orders.toLocaleString(),
      label: 'Orders Received',
      chip: `${summary.count} nodes`,
      up: true
    },
    {
      icon: Truck,
      value: feasibleOrders.toLocaleString(),
      label: 'Orders Fulfilled',
      chip: result ? `${(result.metrics.feasibility_ratio * 100).toFixed(0)}% feasible` : 'demand load',
      up: true
    },
    {
      icon: Route,
      value: result ? `${result.metrics.avg_distance_per_order_km} km` : '—',
      label: 'Avg Distance / Order',
      chip: result ? `was ${result.comparison?.baseline.metrics.avg_distance_per_order_km} km` : 'run optimizer',
      up: false
    },
    {
      icon: DollarSign,
      value: result ? `$${result.comparison?.delta.cost_saved.toLocaleString() ?? '0'}` : '—',
      label: 'Delivery Cost Saved',
      chip: result ? `${result.comparison?.delta.pct_cost_saved ?? 0}% saved` : 'run optimizer',
      up: true
    }
  ];

  const monthOrders = summary.total_orders * 30;

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-5 items-start">
      {/* Left: sections + charts */}
      <div className="xl:col-span-2 space-y-5">
        <SectionOverview
          neighborhoods={neighborhoods}
          warehouses={result?.warehouses ?? []}
          assignments={result?.assignments ?? []}
          groupBy={result ? 'warehouse' : 'zone'}
          selectedId={selectedWh}
          onSelect={onSelectWh}
          onAddRequest={onAddRequest}
          onEditSection={onEditSection}
          onDeleteResult={result ? onDeleteResult : undefined}
        />
        <div className="flex flex-col md:flex-row gap-5">
          <OrderBarChart result={result} />
          <SavingsGauge result={result} onRun={onRunOptimizer} />
        </div>
      </div>

      {/* Right: hero + usage + inventory */}
      <div className="space-y-5">
        <div
          className="rounded-3xl border border-[#E7E3D3] p-5 overflow-hidden relative"
          style={{ background: 'linear-gradient(135deg, #DCE7D4 0%, #EDF0DF 55%, #F2E3B6 100%)' }}
        >
          <div className="flex items-start justify-between">
            <div>
              <div className="font-display font-semibold text-[30px] text-ink leading-none">
                {monthOrders.toLocaleString()}
              </div>
              <div className="text-[13px] font-semibold text-ink mt-1">Orders This Month</div>
            </div>
            <span className="text-[10px] font-bold text-white bg-pine-800 rounded-full px-2.5 py-1">
              {(result?.comparison?.delta.pct_cost_saved ?? 0).toFixed(0)}% ↘
            </span>
          </div>
          <div className="flex gap-2 mt-3">
            <span className="text-[10px] font-semibold bg-white/70 border border-white rounded-full px-2.5 py-1 text-ink">
              {(result?.warehouses.length ?? 0)} warehouses
            </span>
            <span className="text-[10px] font-semibold bg-white/70 border border-white rounded-full px-2.5 py-1 text-ink">
              {summary.count} neighborhoods
            </span>
          </div>
          <div
            className="absolute -bottom-10 -right-10 w-44 h-44 rounded-full opacity-60"
            style={{ background: 'radial-gradient(circle at 35% 35%, #FFFFFF 0%, #C9D6C2 35%, #7A8B6F 70%, #F2C14E 100%)' }}
          />
        </div>

        <UsageDonut
          warehouses={result?.warehouses ?? []}
          assignments={result?.assignments ?? []}
          neighborhoods={neighborhoods}
          selectedId={selectedWh}
          capacityPerWarehouse={result?.config.capacity_enabled ? (result?.config.C_max ?? null) : null}
        />

        <div className="card p-5">
          <h3 className="font-display font-semibold text-[19px] text-ink mb-3">Inventory Overview</h3>
          <div className="grid grid-cols-2 gap-3">
            {cards.map((c) => {
              const Icon = c.icon;
              return (
                <div key={c.label} className="rounded-2xl border border-[#ECE9DB] p-3.5 bg-[#FBFAF4]">
                  <div className="flex items-center justify-between">
                    <span className="w-8 h-8 rounded-full bg-cream-deep flex items-center justify-center text-ink">
                      <Icon className="w-4 h-4" />
                    </span>
                    <span className={`text-[10px] font-bold flex items-center gap-0.5 ${c.up ? 'text-pine-600' : 'text-red-500'}`}>
                      {c.up ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                    </span>
                  </div>
                  <div className="text-[19px] font-bold text-ink mt-2 leading-none">{c.value}</div>
                  <div className="text-[10px] text-ink-faint mt-1 leading-tight">{c.label}<br />{c.chip}</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
