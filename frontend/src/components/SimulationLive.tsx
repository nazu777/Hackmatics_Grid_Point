import React from 'react';
import { Activity, ArrowRight, Fuel, Siren } from 'lucide-react';
import type { OrderMove } from '../types';

interface SimulationLiveProps {
  tick: number;
  moves: OrderMove[];
  capacityUpdates: Record<string, { assigned_orders: number; utilization_pct: number | null }>;
  fuelSnapshot?: { prices: Record<string, number>; live: boolean; note: string } | null;
  zoneIntensities?: Record<string, number> | null;
  onOpenWarehouse?: (warehouseId: string) => void;
}

/**
 * Phase I (#6): live order-move feed + capacity meters. Ticks visibly move
 * orders (from → to per warehouse), capacity bars breathe without
 * re-optimize, and the fuel/traffic snapshot shows per tick.
 * Owned by Phase I; rendered inside the ScenariosPanel tick region.
 */
export const SimulationLive: React.FC<SimulationLiveProps> = ({
  tick,
  moves,
  capacityUpdates,
  fuelSnapshot,
  zoneIntensities,
  onOpenWarehouse
}) => {
  const whIds = Object.keys(capacityUpdates || {});
  const zones = Object.entries(zoneIntensities || {});
  return (
    <div className="bg-white rounded-2xl border border-[#E4E1D2] px-3 py-2.5 space-y-2">
      <div className="flex items-center gap-1.5 text-[12px] font-bold text-ink">
        <Activity className="w-3.5 h-3.5" />
        <span>Live tick {tick}</span>
        <span className="font-semibold text-ink-faint">
          • {moves.length} order{moves.length === 1 ? '' : 's'} moved
        </span>
      </div>

      {moves.length > 0 ? (
        <div className="max-h-24 overflow-y-auto space-y-1 pr-1">
          {moves.slice(0, 12).map((m) => (
            <div key={`${m.order_id}-${m.from_warehouse}-${m.to_warehouse}`} className="flex items-center gap-1.5 text-[11px]">
              <span className="font-mono font-bold text-ink truncate">{m.order_id}</span>
              <button
                onClick={() => onOpenWarehouse?.(m.from_warehouse)}
                className="font-mono text-rose-700 hover:underline cursor-pointer shrink-0"
              >
                {m.from_warehouse}
              </button>
              <ArrowRight className="w-3 h-3 text-ink-faint shrink-0" />
              <button
                onClick={() => onOpenWarehouse?.(m.to_warehouse)}
                className="font-mono text-emerald-700 hover:underline cursor-pointer shrink-0"
              >
                {m.to_warehouse}
              </button>
            </div>
          ))}
          {moves.length > 12 && (
            <p className="text-[10px] text-ink-faint">+{moves.length - 12} more moves</p>
          )}
        </div>
      ) : (
        <p className="text-[11px] text-ink-faint">No order moves this tick — network is stable.</p>
      )}

      {whIds.length > 0 && (
        <div className="space-y-1.5">
          {whIds.map((wid) => {
            const u = capacityUpdates[wid];
            const pct = u.utilization_pct;
            return (
              <div key={wid} className="flex items-center gap-2 text-[11px]">
                <button
                  onClick={() => onOpenWarehouse?.(wid)}
                  className="font-mono font-bold text-ink hover:underline cursor-pointer w-10 text-left shrink-0"
                >
                  {wid}
                </button>
                <div className="flex-1 h-1.5 rounded-full bg-cream-deep overflow-hidden">
                  <div
                    className={`h-full transition-all ${pct != null && pct > 100 ? 'bg-rose-500' : pct != null && pct > 85 ? 'bg-amber-500' : 'bg-[#14424E]'}`}
                    style={{ width: `${pct != null ? Math.min(100, pct) : 0}%` }}
                  />
                </div>
                <span className="font-mono text-ink-soft shrink-0">
                  {u.assigned_orders}{pct != null ? ` (${pct}%)` : ''}
                </span>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-ink-faint">
        {fuelSnapshot && (
          <span className="flex items-center gap-1">
            <Fuel className="w-3 h-3" />
            {fuelSnapshot.note}
            {fuelSnapshot.live && <span className="font-extrabold text-emerald-700">LIVE</span>}
          </span>
        )}
        {zones.length > 0 && (
          <span className="flex items-center gap-1">
            <Siren className="w-3 h-3" />
            {zones.map(([w, f]) => `${w} +${(Number(f) * 100).toFixed(0)}%`).join(' · ')}
          </span>
        )}
      </div>
    </div>
  );
};
