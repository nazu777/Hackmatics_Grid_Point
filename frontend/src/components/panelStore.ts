import type { Neighborhood, OptimizationResult } from '../types';

/** Baseline-vs-optimized metrics table CSV (Phase 4 comparison). */
export function buildMetricsCsv(result: OptimizationResult): string {
  const b = result.comparison?.baseline.metrics;
  const o = result.comparison?.optimized.metrics;
  if (!b || !o) return '';
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
  return lines.join('\n');
}

/** Full neighborhood → warehouse assignment CSV. */
export function buildAssignmentsCsv(result: OptimizationResult): string {
  const lines = ['neighborhood_id,warehouse_id,distance_km,weighted_distance,cost,within_radius,is_feasible'];
  result.assignments.forEach((a) =>
    lines.push(`${a.neighborhood_id},${a.warehouse_id},${a.distance_km},${a.weighted_distance},${a.cost},${a.within_radius},${a.is_feasible}`)
  );
  return lines.join('\n');
}

/** Case-insensitive search across id / name / zone. */
export function searchNeighborhoods(neighborhoods: Neighborhood[], q: string): Neighborhood[] {
  const term = q.trim().toLowerCase();
  if (!term) return [];
  return neighborhoods.filter(
    (n) =>
      n.neighborhood_id.toLowerCase().includes(term) ||
      (n.name || '').toLowerCase().includes(term) ||
      (n.zone || '').toLowerCase().includes(term)
  );
}

/** Trigger a client-side file download. */
export function downloadFile(filename: string, text: string, mime = 'text/csv') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const el = document.createElement('a');
  el.href = url;
  el.download = filename;
  el.click();
  URL.revokeObjectURL(url);
}

/** Copy text to clipboard with fallback. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      return true;
    } catch {
      return false;
    }
  }
}

const RECENTS_KEY = 'gridpoint_recents';

/** Recently asked / opened items (max 8, most recent first). */
export function getRecents(): string[] {
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    const arr = raw ? (JSON.parse(raw) as string[]) : [];
    return Array.isArray(arr) ? arr.slice(0, 8) : [];
  } catch {
    return [];
  }
}

export function pushRecent(q: string) {
  const term = q.trim();
  if (!term) return;
  try {
    const next = [term, ...getRecents().filter((r) => r.toLowerCase() !== term.toLowerCase())].slice(0, 8);
    localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

export interface SavedList {
  id: string;
  name: string;
  createdAt: string;
  neighborhoods: Neighborhood[];
}

export interface SavedResult {
  id: string;
  name: string;
  createdAt: string;
  k: number;
  pctSaved: number;
  costSaved: number;
  result: OptimizationResult;
}

const LISTS_KEY = 'gridpoint_saved_lists';
const RESULTS_KEY = 'gridpoint_saved_results';

function read<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    const arr = raw ? (JSON.parse(raw) as T[]) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function write(key: string, arr: unknown[]) {
  try {
    localStorage.setItem(key, JSON.stringify(arr));
  } catch {
    /* ignore */
  }
}

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function getSavedLists(): SavedList[] {
  return read<SavedList>(LISTS_KEY);
}

export function saveList(name: string, neighborhoods: Neighborhood[]): SavedList {
  const entry: SavedList = {
    id: uid(),
    name: name.trim() || `List ${getSavedLists().length + 1}`,
    createdAt: new Date().toISOString(),
    neighborhoods
  };
  const next = [entry, ...getSavedLists()].slice(0, 20);
  write(LISTS_KEY, next);
  return entry;
}

export function deleteList(id: string) {
  write(LISTS_KEY, getSavedLists().filter((l) => l.id !== id));
}

export function getSavedResults(): SavedResult[] {
  return read<SavedResult>(RESULTS_KEY);
}

export function saveResult(name: string, result: OptimizationResult): SavedResult {
  const entry: SavedResult = {
    id: uid(),
    name: name.trim() || `Run K=${result.config.K}`,
    createdAt: new Date().toISOString(),
    k: result.config.K,
    pctSaved: result.comparison?.delta.pct_cost_saved ?? 0,
    costSaved: result.comparison?.delta.cost_saved ?? 0,
    result
  };
  const next = [entry, ...getSavedResults()].slice(0, 10);
  write(RESULTS_KEY, next);
  return entry;
}

export function deleteResult(id: string) {
  write(RESULTS_KEY, getSavedResults().filter((r) => r.id !== id));
}

/** Great-circle distance in km (for Nearby ranking). */
export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371.0088;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Nearest N neighborhoods to a point (excluding itself). */
export function nearestTo(neighborhoods: Neighborhood[], lat: number, lon: number, n = 3): { node: Neighborhood; km: number }[] {
  return neighborhoods
    .map((node) => ({ node, km: haversineKm(lat, lon, node.latitude, node.longitude) }))
    .filter((x) => x.km > 1e-9)
    .sort((a, b) => a.km - b.km)
    .slice(0, n);
}
