import React, { useMemo } from 'react';
import type { Assignment, Neighborhood, Warehouse } from '../types';

interface UsageDonutProps {
  warehouses: Warehouse[];
  assignments: Assignment[];
  neighborhoods: Neighborhood[];
  selectedId: string | null;
  capacityPerWarehouse?: number | null;
}

/**
 * IronNest-style usage ring: selected warehouse load with 2x2 stat grid.
 * Ring % = capacity utilization when C_max is set, else share of total demand.
 */
export const UsageDonut: React.FC<UsageDonutProps> = ({
  warehouses,
  assignments,
  neighborhoods,
  selectedId,
  capacityPerWarehouse
}) => {
  const stats = useMemo(() => {
    const sel = warehouses.find((w) => w.warehouse_id === selectedId) || warehouses[0];
    if (!sel) return null;
    const totalDemand = neighborhoods.reduce((s, n) => s + (Number(n.daily_orders) || 0), 0);
    const selAsg = assignments.filter((a) => a.warehouse_id === sel.warehouse_id);
    const nbById = new Map(neighborhoods.map((n) => [n.neighborhood_id, n]));
    const orders = selAsg.reduce((s, a) => s + (Number(nbById.get(a.neighborhood_id)?.daily_orders) || 0), 0);
    const dists = selAsg.map((a) => a.distance_km);
    const avg = dists.length ? dists.reduce((s, d) => s + d, 0) / dists.length : 0;
    const infeasible = selAsg.filter((a) => !a.is_feasible).length;
    const pct =
      capacityPerWarehouse && capacityPerWarehouse > 0
        ? Math.min(100, (orders / capacityPerWarehouse) * 100)
        : totalDemand > 0
          ? (orders / totalDemand) * 100
          : 0;
    return {
      id: sel.warehouse_id,
      title: `${sel.warehouse_id.replace(/^W/i, '')}-Section Usage`,
      pct,
      orders,
      nodes: selAsg.length,
      avg,
      infeasible,
      subtitle: capacityPerWarehouse && capacityPerWarehouse > 0 ? 'Capacity Used' : 'Demand Share'
    };
  }, [warehouses, assignments, neighborhoods, selectedId, capacityPerWarehouse]);

  if (!stats) {
    return (
      <div className="card p-5">
        <h3 className="font-display font-semibold text-[19px] text-ink mb-2">Section Usage</h3>
        <p className="text-xs text-ink-faint">Run the optimizer to see per-warehouse load.</p>
      </div>
    );
  }

  const R = 34;
  const C = 2 * Math.PI * R;
  const filled = (stats.pct / 100) * C;

  return (
    <div className="card p-5">
      <h3 className="font-display font-semibold text-[19px] text-ink mb-3">{stats.title}</h3>
      <div className="flex items-center gap-4">
        <div className="relative w-[92px] h-[92px] shrink-0">
          <svg viewBox="0 0 92 92" className="w-full h-full -rotate-90">
            <circle cx="46" cy="46" r={R} fill="none" stroke="#ECE9DB" strokeWidth="11" />
            <circle
              cx="46"
              cy="46"
              r={R}
              fill="none"
              stroke="#F2C14E"
              strokeWidth="11"
              strokeLinecap="round"
              strokeDasharray={`${filled} ${C}`}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-[19px] font-bold text-ink leading-none">{stats.pct.toFixed(0)}%</span>
            <span className="text-[9px] text-ink-faint mt-0.5">{stats.subtitle}</span>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-x-5 gap-y-3 flex-1">
          <div>
            <div className="text-[19px] font-bold text-ink leading-none">{stats.orders.toLocaleString()}</div>
            <div className="text-[10px] text-ink-faint mt-1">Assigned Orders</div>
          </div>
          <div>
            <div className="text-[19px] font-bold text-ink leading-none">{stats.nodes}</div>
            <div className="text-[10px] text-ink-faint mt-1">Assigned Nodes</div>
          </div>
          <div>
            <div className="text-[19px] font-bold text-ink leading-none">{stats.avg.toFixed(1)} km</div>
            <div className="text-[10px] text-ink-faint mt-1">Avg Distance</div>
          </div>
          <div>
            <div className={`text-[19px] font-bold leading-none ${stats.infeasible > 0 ? 'text-red-600' : 'text-ink'}`}>
              {stats.infeasible}
            </div>
            <div className="text-[10px] text-ink-faint mt-1">Violations</div>
          </div>
        </div>
      </div>
    </div>
  );
};
