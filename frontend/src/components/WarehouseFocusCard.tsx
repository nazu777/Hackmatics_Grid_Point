import React, { useState } from 'react';
import { X, Crosshair, Package, Users, Ruler, AlertTriangle } from 'lucide-react';
import type { WarehouseFocus } from '../services/api';

/** Phase B (#1): isolated warehouse zone detail card.
 * Shows zone id, center, assigned_orders (Σ daily_orders), utilization,
 * capacity/radius/infra, and the full assigned-node list with per-node
 * daily_orders + distance. Clear-focus control restores all zones. */
export const WarehouseFocusCard: React.FC<{
  focus: WarehouseFocus;
  onClear: () => void;
  onCenter: (lat: number, lon: number) => void;
  onOpenNode?: (neighborhoodId: string) => void;
}> = ({ focus, onClear, onCenter, onOpenNode }) => {
  const [query, setQuery] = useState('');
  if (!focus.found) return null;
  const members = focus.members ?? [];
  const q = query.trim().toLowerCase();
  const shown = q
    ? members.filter(
        (m) =>
          m.neighborhood_id.toLowerCase().includes(q) ||
          (m.name || '').toLowerCase().includes(q) ||
          m.zone.toLowerCase().includes(q)
      )
    : members;
  const rows: [string, string][] = [
    ['Center', focus.center ? `${focus.center.lat.toFixed(5)}, ${focus.center.lon.toFixed(5)}` : '—'],
    ['Assigned orders (Σ wᵢ)', `${(focus.assigned_orders ?? 0).toLocaleString()} orders`],
    ['Nodes served', `${focus.neighborhood_count ?? members.length}`],
    ['Utilization', focus.utilization_pct != null ? `${focus.utilization_pct}%` : '— (no capacity set)'],
    ['Capacity (C_max)', focus.capacity != null ? `${focus.capacity} orders` : '—'],
    ['Radius (R_max)', focus.radius_km != null ? `${focus.radius_km} km` : '—'],
    ['Infra cost', focus.infra_cost != null ? `$${Number(focus.infra_cost).toLocaleString()}` : '—'],
    ['Avg / max distance', `${focus.avg_distance_km ?? 0} / ${focus.max_distance_km ?? 0} km`]
  ];
  return (
    <div className="absolute top-[124px] left-4 z-20 w-[340px] max-w-[calc(100%-2rem)] bg-white rounded-3xl border border-[#E4E1D2] shadow-xl shadow-black/15 overflow-hidden">
      <div className="px-4 pt-3 pb-2 flex items-start justify-between gap-2 border-b border-[#E4E1D2]">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              className="w-3 h-3 rounded-full shrink-0"
              style={{ background: focus.color || '#0ea5e9' }}
            />
            <h3 className="font-bold text-sm text-ink truncate">Zone {focus.warehouse_id}</h3>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-900 text-white shrink-0">
              isolated
            </span>
          </div>
          <p className="text-[11px] text-ink-faint mt-0.5">
            Other zones dimmed for clarity • {members.length} nodes
          </p>
        </div>
        <button
          onClick={onClear}
          title="Clear focus — show all zones"
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-full bg-cream-deep hover:bg-gold-100 text-[11px] font-bold text-ink transition cursor-pointer shrink-0"
        >
          <X className="w-3.5 h-3.5" /> Clear
        </button>
      </div>
      <div className="px-4 py-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[11.5px] max-h-40 overflow-y-auto nice-scroll">
        {rows.map(([k, v]) => (
          <div key={k} className="flex flex-col">
            <span className="text-ink-faint text-[10px] uppercase tracking-wide">{k}</span>
            <span className="font-semibold text-ink font-mono truncate" title={v}>{v}</span>
          </div>
        ))}
      </div>
      <div className="px-4 pb-2 flex items-center gap-2">
        <button
          onClick={() => focus.center && onCenter(focus.center.lat, focus.center.lon)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#14424E] text-white text-[11px] font-bold hover:opacity-90 transition cursor-pointer"
        >
          <Crosshair className="w-3.5 h-3.5" /> Center zone
        </button>
        <div className="flex items-center gap-1 text-[11px] text-ink-faint">
          <Package className="w-3.5 h-3.5" /> {((focus.assigned_orders ?? 0)).toLocaleString()} orders
        </div>
      </div>
      <div className="px-4 pb-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Filter ${members.length} nodes…`}
          className="w-full px-3 py-1.5 rounded-xl bg-cream-deep text-[12px] text-ink placeholder:text-ink-faint focus:outline-none"
        />
        <div className="mt-2 max-h-52 overflow-y-auto nice-scroll space-y-1">
          {shown.map((m) => (
            <button
              key={m.neighborhood_id}
              onClick={() => onOpenNode?.(m.neighborhood_id)}
              title={m.is_feasible ? `${m.distance_km} km` : `${m.distance_km} km — radius exceeded`}
              className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-xl hover:bg-cream-deep transition cursor-pointer text-left"
            >
              <span className="min-w-0">
                <span className="block text-[12px] font-bold text-ink font-mono truncate">
                  {m.neighborhood_id} <span className="font-sans font-semibold">• {m.name}</span>
                </span>
                <span className="flex items-center gap-1.5 text-[10.5px] text-ink-faint">
                  <Users className="w-3 h-3" /> {m.daily_orders} orders
                  <Ruler className="w-3 h-3 ml-1" /> {m.distance_km} km
                  {!m.is_feasible && <AlertTriangle className="w-3 h-3 text-amber-600" />}
                </span>
              </span>
              <span className="text-ink-faint shrink-0">›</span>
            </button>
          ))}
          {shown.length === 0 && (
            <p className="text-[11px] text-ink-faint text-center py-4">No nodes match “{query}”.</p>
          )}
        </div>
      </div>
    </div>
  );
};
