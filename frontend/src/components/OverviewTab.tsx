import React from 'react';
import {
  Truck,
  Fuel,
  Warehouse,
  Package,
  Route,
  Bell,
  RefreshCw,
  ArrowRight,
  Activity
} from 'lucide-react';
import type { RailTab } from './GmapsRail';
import type { OptimizationResult, OverviewAggregate } from '../types';

interface OverviewTabProps {
  overview: OverviewAggregate | null;
  loading: boolean;
  result: OptimizationResult | null;
  nodeCount: number;
  onRefresh: () => void;
  onGoTo: (t: RailTab) => void;
}

const Row: React.FC<{ label: string; value: string; sub?: string }> = ({ label, value, sub }) => (
  <div className="flex items-baseline justify-between py-1.5 border-b border-[#E4E1D2] last:border-none">
    <span className="text-[12px] text-ink-faint">{label}</span>
    <span className="text-right">
      <span className="text-[13px] font-extrabold text-ink">{value}</span>
      {sub && <span className="block text-[10px] text-ink-faint font-medium">{sub}</span>}
    </span>
  </div>
);

export const OverviewTab: React.FC<OverviewTabProps> = ({
  overview,
  loading,
  result,
  nodeCount,
  onRefresh,
  onGoTo
}) => {
  const go = (t: RailTab, label: string) => (
    <button
      onClick={() => onGoTo(t)}
      className="mt-3 inline-flex items-center gap-1 px-3 py-1.5 bg-cream-deep hover:bg-gold-100 text-ink rounded-full text-[11px] font-bold transition cursor-pointer"
    >
      <span>{label}</span>
      <ArrowRight className="w-3 h-3" />
    </button>
  );

  const fuelEntries = overview ? Object.entries(overview.fuel_price.prices || {}) : [];
  const mixEntries = overview ? Object.entries(overview.vehicle_mix || {}) : [];

  return (
    <div className="space-y-4 pb-8">
      <div className="card p-5">
        <div className="flex items-center justify-between">
          <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-grape-100 text-grape-600 text-xs font-bold">
            <Activity className="w-3.5 h-3.5" />
            <span>Overview</span>
          </div>
          <button
            onClick={onRefresh}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#14424E] hover:bg-[#0d333d] text-white rounded-full text-[11px] font-bold transition cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
            <span>{loading ? 'Refreshing…' : 'Refresh'}</span>
          </button>
        </div>
        <h2 className="font-display font-semibold text-[22px] text-ink leading-tight mt-2">
          Network at a glance
        </h2>
        <p className="text-ink-faint text-[13px] mt-1.5 leading-relaxed">
          Every figure below is aggregated from its source tab — tap through to audit any number.
        </p>
        {!result && (
          <p className="mt-3 text-[12px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
            No optimization result yet — run Optimize first for distance, cost and utilization rows.
          </p>
        )}
      </div>

      {overview?.alerts && overview.alerts.length > 0 && (
        <div className="card p-4 border-rose-200 bg-rose-50/60">
          <div className="flex items-center gap-2 mb-2">
            <Bell className="w-4 h-4 text-rose-600" />
            <h3 className="text-sm font-bold text-rose-900">Active alerts ({overview.alerts.length})</h3>
          </div>
          <ul className="space-y-1.5">
            {overview.alerts.map((a, i) => (
              <li key={i} className="text-[12px] text-rose-800 font-medium bg-white/70 rounded-lg px-2.5 py-1.5 border border-rose-100">
                {a}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="card p-4">
        <div className="flex items-center gap-2.5 pb-3 border-b border-[#E4E1D2]">
          <span className="w-9 h-9 rounded-xl bg-cream-deep text-ink flex items-center justify-center"><Truck className="w-4.5 h-4.5" /></span>
          <div>
            <h3 className="text-sm font-bold text-ink">Vehicles · {overview?.vehicle_count ?? 0}</h3>
            <p className="text-[11px] text-ink-faint">Fleet mix from optimizer config</p>
          </div>
        </div>
        <div className="pt-1">
          {mixEntries.length === 0 && <Row label="Fleet mix" value="—" sub="No vehicles configured yet" />}
          {mixEntries.map(([k, v]) => (
            <Row key={k} label={k} value={`×${v}`} />
          ))}
          <Row label="Total vehicles" value={String(overview?.vehicle_count ?? 0)} />
        </div>
        {go('lab', 'Fleet & ETA in Scenario lab')}
      </div>

      <div className="card p-4">
        <div className="flex items-center gap-2.5 pb-3 border-b border-[#E4E1D2]">
          <span className="w-9 h-9 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center"><Fuel className="w-4.5 h-4.5" /></span>
          <div>
            <h3 className="text-sm font-bold text-ink">
              Fuel prices {overview && (overview.fuel_price.live ? <span className="ml-1 text-[10px] font-extrabold text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded-full">LIVE</span> : <span className="ml-1 text-[10px] font-extrabold text-ink-faint bg-cream-deep px-1.5 py-0.5 rounded-full">FALLBACK</span>)}
            </h3>
            <p className="text-[11px] text-ink-faint">{overview?.fuel_price.note || 'No fuel data yet'}</p>
          </div>
        </div>
        <div className="pt-1">
          {fuelEntries.length === 0 && <Row label="₹/litre" value="—" sub="Enable live fuel in Optimize" />}
          {fuelEntries.map(([k, v]) => (
            <Row key={k} label={k} value={`₹${Number(v).toFixed(2)}/L`} />
          ))}
        </div>
        {go('optimize', 'Fuel settings in Optimize')}
      </div>

      <div className="card p-4">
        <div className="flex items-center gap-2.5 pb-3 border-b border-[#E4E1D2]">
          <span className="w-9 h-9 rounded-xl bg-grape-100 text-grape-600 flex items-center justify-center"><Warehouse className="w-4.5 h-4.5" /></span>
          <div>
            <h3 className="text-sm font-bold text-ink">Warehouses · {overview?.warehouse_count ?? 0}</h3>
            <p className="text-[11px] text-ink-faint">Count, utilization & infra</p>
          </div>
        </div>
        <div className="pt-1">
          <Row label="Infra / warehouse" value={`$${(overview?.infra_price.per_warehouse ?? 0).toLocaleString()}`} />
          <Row label="Total infra" value={`$${(overview?.infra_price.total ?? 0).toLocaleString()}`} />
          {(overview?.utilization || []).map((u, i) => (
            <Row key={i} label={`W${i + 1} utilization`} value={u == null ? '—' : `${u.toFixed(1)}%`} />
          ))}
        </div>
        {go('optimize', 'Warehouses in Optimize')}
      </div>

      <div className="card p-4">
        <div className="flex items-center gap-2.5 pb-3 border-b border-[#E4E1D2]">
          <span className="w-9 h-9 rounded-xl bg-gold-100 text-gold-600 flex items-center justify-center"><Package className="w-4.5 h-4.5" /></span>
          <div>
            <h3 className="text-sm font-bold text-ink">Orders</h3>
            <p className="text-[11px] text-ink-faint">{nodeCount} demand nodes loaded</p>
          </div>
        </div>
        <div className="pt-1">
          <Row label="Demand nodes" value={String(overview?.order_totals.nodes ?? nodeCount)} />
          <Row label="Daily orders" value={(overview?.order_totals.daily_orders ?? 0).toLocaleString()} />
        </div>
        {go('data', 'Demand data')}
      </div>

      <div className="card p-4">
        <div className="flex items-center gap-2.5 pb-3 border-b border-[#E4E1D2]">
          <span className="w-9 h-9 rounded-xl bg-cream-deep text-ink flex items-center justify-center"><Route className="w-4.5 h-4.5" /></span>
          <div>
            <h3 className="text-sm font-bold text-ink">Distance · Cost · Fuel · Congestion</h3>
            <p className="text-[11px] text-ink-faint">Optimized layout totals</p>
          </div>
        </div>
        <div className="pt-1">
          <Row label="Weighted distance" value={`${(overview?.distance_cost.total_weighted_distance_km_orders ?? 0).toLocaleString()} km·orders`} />
          <Row label="Total cost" value={`$${(overview?.distance_cost.total_cost ?? 0).toLocaleString()}`} />
          <Row label="Fuel cost portion ($)" value={`$${(overview?.distance_cost.total_fuel_cost ?? 0).toLocaleString()}`} />
          <Row label="Avg distance / order" value={`${overview?.distance_cost.avg_distance_per_order_km ?? 0} km`} />
          <Row label="Avg corridor congestion" value={`${((overview?.distance_cost.avg_congestion_pct ?? 0) * 100).toFixed(1)}%`} />
          <Row label="Feasibility ratio" value={`${((overview?.distance_cost.feasibility_ratio ?? 1) * 100).toFixed(1)}%`} />
        </div>
        {go('compare', 'Cost breakdown in Compare')}
      </div>
    </div>
  );
};
