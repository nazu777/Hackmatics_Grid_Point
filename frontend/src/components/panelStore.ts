import type { Neighborhood, OptimizationConfig, OptimizationResult, VehicleType, Warehouse } from '../types';

/**
 * Suggest a feasible per-warehouse capacity for a dataset: 1.5× fair share,
 * rounded up to a neat number (min 100). Keeps the default demo feasible
 * while showing real utilization gauges.
 */
export function suggestCapacity(neighborhoods: Neighborhood[], k: number): number {
  const total = neighborhoods.reduce((s, n) => s + (Number(n.daily_orders) || 0), 0);
  const fairShare = total / Math.max(1, k);
  return Math.max(100, Math.ceil((fairShare * 1.5) / 50) * 50);
}

/**
 * Factory defaults for a fresh optimizer setup: capacity, radius, live fuel
 * and live traffic all ON, with capacity sized to the actual demand so the
 * first run is feasible and utilization/radius/violation features light up.
 */
export function smartDefaults(neighborhoods: Neighborhood[], k: number): Partial<OptimizationConfig> {
  return {
    capacity_enabled: true,
    C_max: suggestCapacity(neighborhoods, k),
    radius_enabled: true,
    R_max_km: 25,
    use_live_fuel: true,
    fuel_state: 'Karnataka',
    fuel_city: null,
    use_live_traffic: true
  };
}

/** Geographic center of a dataset (mean lat/lon). */
export function datasetCenter(neighborhoods: Neighborhood[]): { lat: number; lon: number } | null {
  const pts = neighborhoods.filter(
    (n) => Number.isFinite(Number(n.latitude)) && Number.isFinite(Number(n.longitude))
  );
  if (pts.length === 0) return null;
  return {
    lat: pts.reduce((s, n) => s + Number(n.latitude), 0) / pts.length,
    lon: pts.reduce((s, n) => s + Number(n.longitude), 0) / pts.length
  };
}

/** Approximate centroids for auto-matching a dataset to its nearest price city. */
export const CITY_COORDS: Record<string, { lat: number; lon: number }> = {
  Bagalkot: { lat: 16.18, lon: 75.7 }, Ballari: { lat: 15.14, lon: 76.93 },
  Belgaum: { lat: 15.85, lon: 74.51 }, Bengaluru: { lat: 12.97, lon: 77.59 },
  Bidar: { lat: 17.91, lon: 77.52 }, Chamarajanagar: { lat: 11.93, lon: 76.95 },
  Chickmagaluru: { lat: 13.32, lon: 75.77 }, Chikkaballapura: { lat: 13.43, lon: 77.73 },
  Chitradurga: { lat: 14.23, lon: 76.4 }, Davangere: { lat: 14.47, lon: 75.92 },
  Dharwad: { lat: 15.46, lon: 75.01 }, Gadag: { lat: 15.43, lon: 75.63 },
  Gulbarga: { lat: 17.33, lon: 76.83 }, Hassan: { lat: 13.01, lon: 76.1 },
  Haveri: { lat: 14.8, lon: 75.14 }, Karwar: { lat: 14.81, lon: 74.13 },
  Kolar: { lat: 13.14, lon: 78.13 }, Koppal: { lat: 15.35, lon: 76.15 },
  Mandya: { lat: 12.52, lon: 76.9 }, Mangalore: { lat: 12.91, lon: 74.86 },
  Mysore: { lat: 12.3, lon: 76.65 }, Raichur: { lat: 16.21, lon: 77.36 },
  Ramanagara: { lat: 12.72, lon: 77.28 }, Shimoga: { lat: 13.93, lon: 75.57 },
  Tumakuru: { lat: 13.34, lon: 77.1 }, Udupi: { lat: 13.34, lon: 74.75 },
  Yadgir: { lat: 16.77, lon: 77.13 }
};

/**
 * Nearest priced city to a dataset center — the UI never asks the user
 * which city to price fuel at. Returns null when nothing matches.
 */
export function nearestPricedCity(
  center: { lat: number; lon: number } | null,
  cities: { city: string }[]
): string | null {
  if (!center) return null;
  let best: string | null = null;
  let bestD = Infinity;
  for (const c of cities) {
    const loc = CITY_COORDS[c.city.trim()];
    if (!loc) continue;
    const d = haversineKm(center.lat, center.lon, loc.lat, loc.lon);
    if (d < bestD) {
      bestD = d;
      best = c.city;
    }
  }
  return best;
}
/**
 * Per-account scoping for recents / saved lists / saved runs.
 * AppShell calls setStoreUser(user.id) on mount (before children read the
 * store), so a fresh account starts with empty saved data.
 */
let storeUserId: string | null = null;

export function setStoreUser(userId: string | null) {
  storeUserId = userId;
}

function nsKey(key: string): string {
  return storeUserId ? `${key}_${storeUserId}` : key;
}

// --------------------------------------------------------------------------
// Phase A — Onboarding Trio per-user persistence (fresh account = 0/0/0).
// Keys follow the gridpoint_*_<uid> convention; accounts start EMPTY and
// the checklist (orders → vehicles → warehouses → optimize) drives entry.
// --------------------------------------------------------------------------

const NEIGHBORHOODS_KEY = 'gridpoint_neighborhoods';
const VEHICLES_KEY = 'gridpoint_vehicles';
const WAREHOUSES_KEY = 'gridpoint_warehouses';
const WORKSPACE_UPDATED_KEY = 'gridpoint_workspace_updated';
export const WORKSPACE_CHANGED_EVENT = 'gridpoint-workspace-changed';

/** Unix seconds of the last local workspace mutation (per account). */
export function getWorkspaceUpdatedAt(): number {
  try {
    return Number(localStorage.getItem(nsKey(WORKSPACE_UPDATED_KEY))) || 0;
  } catch {
    return 0;
  }
}

export function setWorkspaceUpdatedAt(ts: number) {
  try {
    localStorage.setItem(nsKey(WORKSPACE_UPDATED_KEY), String(Number(ts) || 0));
  } catch { /* ignore */ }
}

/** Mark the workspace dirty + notify subscribers (debounced server push). */
export function touchWorkspace(): number {
  const now = Date.now() / 1000;
  setWorkspaceUpdatedAt(now);
  try {
    window.dispatchEvent(new CustomEvent(WORKSPACE_CHANGED_EVENT));
  } catch { /* ignore */ }
  return now;
}

export function getStoredNeighborhoods(): Neighborhood[] {
  return read<Neighborhood>(NEIGHBORHOODS_KEY);
}

export function setStoredNeighborhoods(rows: Neighborhood[]) {
  write(NEIGHBORHOODS_KEY, rows);
  touchWorkspace();
}

export function getStoredVehicles(): VehicleType[] {
  return read<VehicleType>(VEHICLES_KEY);
}

export function setStoredVehicles(rows: VehicleType[]) {
  write(VEHICLES_KEY, rows);
  touchWorkspace();
}

export function getStoredWarehouses(): Warehouse[] {
  return read<Warehouse>(WAREHOUSES_KEY);
}

export function setStoredWarehouses(rows: Warehouse[]) {
  write(WAREHOUSES_KEY, rows);
  touchWorkspace();
}

export interface OnboardingStatus {
  orderCount: number;
  vehicleCount: number;
  warehouseCount: number;
  hasOrders: boolean;
  hasVehicles: boolean;
  hasWarehouses: boolean;
  readyToOptimize: boolean;
  nextStep: 'orders' | 'vehicles' | 'warehouses' | 'optimize';
}

/** 0/0/0 checklist state for a fresh account (Phase A acceptance). */
export function getOnboardingStatus(): OnboardingStatus {
  const orderCount = getStoredNeighborhoods().length;
  const vehicleCount = getStoredVehicles().length;
  const warehouseCount = getStoredWarehouses().length;
  const hasOrders = orderCount > 0;
  const hasVehicles = vehicleCount > 0;
  const hasWarehouses = warehouseCount > 0;
  const nextStep = !hasOrders ? 'orders' : !hasVehicles ? 'vehicles' : !hasWarehouses ? 'warehouses' : 'optimize';
  return {
    orderCount, vehicleCount, warehouseCount,
    hasOrders, hasVehicles, hasWarehouses,
    readyToOptimize: hasOrders,
    nextStep
  };
}

/** Existing warehouses double as the D-baseline custom set for P1-B/D. */
export function storedWarehousesAsBaseline(): { warehouse_id: string; latitude: number; longitude: number; capacity?: number | null; radius_km?: number | null; infra_cost?: number }[] {
  return getStoredWarehouses()
    .filter((w) => Number.isFinite(Number(w.latitude)) && Number.isFinite(Number(w.longitude)))
    .map((w) => ({
      warehouse_id: w.warehouse_id,
      latitude: Number(w.latitude),
      longitude: Number(w.longitude),
      capacity: w.capacity ?? null,
      radius_km: w.radius_km ?? null,
      infra_cost: w.infra_cost ?? 0
    }));
}

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
  const lines = ['neighborhood_id,warehouse_id,distance_km,weighted_distance,cost,fuel_cost,within_radius,is_feasible'];
  result.assignments.forEach((a) =>
    lines.push(`${a.neighborhood_id},${a.warehouse_id},${a.distance_km},${a.weighted_distance},${a.cost},${a.fuel_cost ?? 0},${a.within_radius},${a.is_feasible}`)
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
    const raw = localStorage.getItem(nsKey(RECENTS_KEY));
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
    localStorage.setItem(nsKey(RECENTS_KEY), JSON.stringify(next));
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
    const raw = localStorage.getItem(nsKey(key));
    const arr = raw ? (JSON.parse(raw) as T[]) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function write(key: string, arr: unknown[]) {
  try {
    localStorage.setItem(nsKey(key), JSON.stringify(arr));
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

// --------------------------------------------------------------------------
// Phase H — Entity bookmarks (#5): star any warehouse/vehicle, revisit fast.
// Append-only: NEW key + NEW functions, no edits to existing fns above.
// Contract: docs/followup_phases.md §1.2.
// --------------------------------------------------------------------------

export interface Bookmark {
  kind: 'warehouse' | 'vehicle';
  id: string;
  savedAt: number;
}

const BOOKMARKS_KEY = 'gridpoint_bookmarks';

export function getBookmarks(): Bookmark[] {
  try {
    const raw = localStorage.getItem(nsKey(BOOKMARKS_KEY));
    const arr = raw ? (JSON.parse(raw) as Bookmark[]) : [];
    if (!Array.isArray(arr)) return [];
    return arr.filter(
      (b) => b && (b.kind === 'warehouse' || b.kind === 'vehicle') && typeof b.id === 'string'
    );
  } catch {
    return [];
  }
}

function writeBookmarks(marks: Bookmark[]) {
  try {
    localStorage.setItem(nsKey(BOOKMARKS_KEY), JSON.stringify(marks));
  } catch {
    /* ignore */
  }
}

export function isBookmarked(kind: Bookmark['kind'], id: string): boolean {
  return getBookmarks().some((b) => b.kind === kind && b.id === id);
}

export function toggleBookmark(kind: Bookmark['kind'], id: string): Bookmark[] {
  const marks = getBookmarks();
  const i = marks.findIndex((b) => b.kind === kind && b.id === id);
  const next =
    i >= 0
      ? marks.filter((_, j) => j !== i)
      : [...marks, { kind, id, savedAt: Date.now() }];
  writeBookmarks(next);
  return next;
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
