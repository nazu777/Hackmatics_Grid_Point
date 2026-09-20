import type { Neighborhood, VehicleType, Warehouse } from '../types';

/**
 * Phase J (#7): unified token index over nodes, warehouses, vehicles
 * (trucks/cars via fleet type) and orders.
 * Contract: docs/followup_phases.md §1.1 SearchHit.
 */

export interface SearchHit {
  kind: 'node' | 'warehouse' | 'vehicle' | 'order';
  id: string;
  label: string;
  sub: string;
  refId: string;
}

export type SearchCategory = 'all' | 'nodes' | 'warehouses' | 'vehicles' | 'orders';

export const SEARCH_CATEGORIES: { id: SearchCategory; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'nodes', label: 'Nodes' },
  { id: 'warehouses', label: 'Warehouses' },
  { id: 'vehicles', label: 'Trucks & cars' },
  { id: 'orders', label: 'Orders' }
];

export interface SearchCorpus {
  nodes: Neighborhood[];
  warehouses: Warehouse[];
  vehicles: VehicleType[];
}

function tokens(q: string): string[] {
  return q
    .trim()
    .toLowerCase()
    .split(/[\s,;|]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

function haystack(...parts: (string | number | null | undefined)[]): string {
  return parts
    .map((p) => (p == null ? '' : String(p)))
    .join(' ')
    .toLowerCase();
}

/** Score: 2 = id prefix/exact, 1 = substring. 0 = no match (all tokens must hit). */
function matchScore(text: string, toks: string[]): number {
  let score = 0;
  for (const t of toks) {
    if (!text.includes(t)) return 0;
    const words = text.split(/[\s\-_#./]+/);
    score += words.some((w) => w === t || w.startsWith(t)) ? 2 : 1;
  }
  return score;
}

function orderLabel(n: Neighborhood): string {
  return `${n.daily_orders} orders @ ${n.name || n.neighborhood_id}`;
}

/**
 * Ranked hits across all kinds. Empty query returns [] so callers can show
 * the hint state (no dead search states — J acceptance).
 */
export function searchAll(corpus: SearchCorpus, query: string, category: SearchCategory = 'all'): SearchHit[] {
  const toks = tokens(query);
  if (toks.length === 0) return [];
  const out: { hit: SearchHit; score: number }[] = [];
  const want = (c: SearchCategory) => category === 'all' || category === c;

  if (want('nodes')) {
    for (const n of corpus.nodes || []) {
      const text = haystack(n.neighborhood_id, n.name, n.zone, n.daily_orders);
      const s = matchScore(text, toks);
      if (s > 0) {
        out.push({
          score: s + 2,
          hit: {
            kind: 'node',
            id: n.neighborhood_id,
            label: `${n.neighborhood_id} • ${n.name || n.neighborhood_id}`,
            sub: `${n.daily_orders} orders • ${n.zone || 'Unzoned'}`,
            refId: n.neighborhood_id
          }
        });
      }
    }
  }
  if (want('warehouses')) {
    for (const w of corpus.warehouses || []) {
      const text = haystack(w.warehouse_id, w.capacity, w.radius_km, w.assigned_orders);
      const s = matchScore(text, toks);
      if (s > 0) {
        out.push({
          score: s + 1,
          hit: {
            kind: 'warehouse',
            id: w.warehouse_id,
            label: `${w.warehouse_id} • warehouse`,
            sub: `${w.assigned_orders || 0} orders${w.capacity ? ` / ${w.capacity} cap` : ''}`,
            refId: w.warehouse_id
          }
        });
      }
    }
  }
  if (want('vehicles')) {
    for (const v of corpus.vehicles || []) {
      const text = haystack(v.vehicle_type, v.fuel_type, v.capacity, v.avg_speed_kmph);
      const s = matchScore(text, toks);
      if (s > 0) {
        const fleetKind = /truck/i.test(v.vehicle_type) ? 'truck' : /car|van|bike|ev/i.test(v.vehicle_type) ? 'car' : 'vehicle';
        out.push({
          score: s + 1,
          hit: {
            kind: 'vehicle',
            id: v.vehicle_type,
            label: `${v.vehicle_type} • ${fleetKind}`,
            sub: `${v.fuel_type || 'petrol'} • cap ${v.capacity} • ₹${v.cost_per_km}/km`,
            refId: v.vehicle_type
          }
        });
      }
    }
  }
  if (want('orders')) {
    for (const n of corpus.nodes || []) {
      // Orders are per-node volumes: match the count string + node identity.
      const text = haystack(n.daily_orders, `orders ${n.daily_orders}`, n.neighborhood_id, n.name);
      const s = matchScore(text, toks);
      if (s > 0) {
        out.push({
          score: s,
          hit: {
            kind: 'order',
            id: `${n.neighborhood_id}:orders`,
            label: orderLabel(n),
            sub: `${n.neighborhood_id} • ${n.zone || 'Unzoned'}`,
            refId: n.neighborhood_id
          }
        });
      }
    }
  }
  return out
    .sort((a, b) => b.score - a.score || a.hit.label.localeCompare(b.hit.label))
    .slice(0, 30)
    .map((r) => r.hit);
}
