import React, { useMemo } from 'react';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import type { Assignment, Neighborhood, Warehouse } from '../types';

/** Pastel column palette cycling per warehouse/zone (IronNest section colors). */
export const SECTION_PASTELS = ['#BFE3C6', '#F7ECCB', '#D8D2E6', '#BCD6D2', '#F3D3CF', '#C6DDEC'];

export interface SectionGroup {
  id: string;
  title: string;
  used: number;
  capacity: number;
  color: string;
  members: Neighborhood[];
}

interface SectionOverviewProps {
  neighborhoods: Neighborhood[];
  warehouses: Warehouse[];
  assignments: Assignment[];
  /** Group by warehouse assignment when true, by zone otherwise. */
  groupBy: 'warehouse' | 'zone';
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAddRequest: () => void;
  onEditSection: () => void;
  onDeleteResult?: () => void;
  maxTiles?: number;
}

function shortId(id: string): string {
  const m = id.match(/(\d+)\s*$/);
  if (m) return id.replace(/(\d+)\s*$/, (n) => String(parseInt(n, 10)));
  return id.length > 6 ? id.slice(0, 6) : id;
}

export const SectionOverview: React.FC<SectionOverviewProps> = ({
  neighborhoods,
  warehouses,
  assignments,
  groupBy,
  selectedId,
  onSelect,
  onAddRequest,
  onEditSection,
  onDeleteResult,
  maxTiles = 12
}) => {
  const groups: SectionGroup[] = useMemo(() => {
    if (groupBy === 'warehouse' && warehouses.length > 0) {
      const byWh = new Map<string, Neighborhood[]>();
      const nbById = new Map(neighborhoods.map((n) => [n.neighborhood_id, n]));
      assignments.forEach((a) => {
        const nb = nbById.get(a.neighborhood_id);
        if (!nb) return;
        const list = byWh.get(a.warehouse_id) || [];
        list.push(nb);
        byWh.set(a.warehouse_id, list);
      });
      return warehouses.map((w, i) => {
        const members = (byWh.get(w.warehouse_id) || []).slice().sort((a, b) =>
          a.neighborhood_id.localeCompare(b.neighborhood_id)
        );
        return {
          id: w.warehouse_id,
          title: `${w.warehouse_id.replace(/^W/i, '')}-Section`,
          used: members.length,
          capacity: members.length,
          color: SECTION_PASTELS[i % SECTION_PASTELS.length],
          members
        };
      });
    }
    // Fallback: group demand nodes by zone
    const byZone = new Map<string, Neighborhood[]>();
    neighborhoods.forEach((n) => {
      const z = (n.zone || 'Unzoned').trim() || 'Unzoned';
      const list = byZone.get(z) || [];
      list.push(n);
      byZone.set(z, list);
    });
    return [...byZone.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 6)
      .map(([z, members], i) => ({
        id: z,
        title: z,
        used: members.length,
        capacity: members.length,
        color: SECTION_PASTELS[i % SECTION_PASTELS.length],
        members: members.slice().sort((a, b) => a.neighborhood_id.localeCompare(b.neighborhood_id))
      }));
  }, [neighborhoods, warehouses, assignments, groupBy]);

  const total = neighborhoods.length;
  const maxRows = Math.max(1, ...groups.map((g) => Math.min(g.members.length, maxTiles)));

  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <h3 className="font-display font-semibold text-[19px] text-ink">
          Section Overview ({total})
        </h3>
        <div className="flex items-center gap-2 text-[11px] font-semibold">
          <button
            onClick={onAddRequest}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-cream-deep text-ink hover:bg-gold-100 transition cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" /> Add Request
          </button>
          <button
            onClick={onEditSection}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-cream-deep text-ink hover:bg-gold-100 transition cursor-pointer"
          >
            <Pencil className="w-3.5 h-3.5" /> Edit Section
          </button>
          {onDeleteResult && (
            <button
              onClick={onDeleteResult}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-cream-deep text-ink hover:bg-red-100 hover:text-red-700 transition cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" /> Delete Section
            </button>
          )}
        </div>
      </div>

      {groups.length === 0 ? (
        <p className="text-xs text-ink-faint py-8 text-center">No sections yet — load demand data to begin.</p>
      ) : (
        <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${Math.min(groups.length, 4)}, minmax(0, 1fr))` }}>
          {groups.slice(0, 4).map((g) => {
            const shown = g.members.slice(0, maxTiles);
            const hidden = g.members.length - shown.length;
            const fillers = Math.max(0, maxRows - shown.length - (hidden > 0 ? 1 : 0));
            const active = selectedId === g.id;
            return (
              <button
                key={g.id}
                onClick={() => onSelect(g.id)}
                className={`rounded-2xl border p-3 text-left transition cursor-pointer ${
                  active ? 'border-pine-700 ring-2 ring-pine-700/30' : 'border-[#E7E3D3] hover:border-pine-200'
                }`}
                style={{ background: '#FBFAF4' }}
              >
                <div className="flex items-center justify-between mb-2 px-0.5">
                  <span className="text-[11px] font-bold text-ink truncate">{g.title}</span>
                  <span className="text-[10px] font-mono text-ink-faint shrink-0 ml-1">
                    {g.used}/{g.capacity}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {shown.map((n) => (
                    <span
                      key={n.neighborhood_id}
                      title={`${n.neighborhood_id} — ${n.name || ''} (${n.daily_orders} orders)`}
                      className="h-9 rounded-xl flex items-center justify-center text-[10px] font-bold text-ink/80 truncate px-1"
                      style={{ background: g.color }}
                    >
                      {shortId(n.neighborhood_id)}
                    </span>
                  ))}
                  {hidden > 0 && (
                    <span
                      className="h-9 rounded-xl flex items-center justify-center text-[10px] font-bold text-white"
                      style={{ background: '#0E4A3E' }}
                    >
                      +{hidden}
                    </span>
                  )}
                  {Array.from({ length: fillers }).map((_, i) => (
                    <span key={`e-${i}`} className="h-9 rounded-xl tile-hatch border border-[#E3DFCE]" />
                  ))}
                </div>
              </button>
            );
          })}
        </div>
      )}
      {groups.length > 4 && (
        <p className="text-[10px] text-ink-faint mt-2">+{groups.length - 4} more sections</p>
      )}
    </div>
  );
};
