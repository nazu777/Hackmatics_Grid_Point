import {
  Neighborhood,
  ValidationResult,
  SyntheticConfig,
  DatasetSummary,
  OptimizationConfig,
  OptimizationResult,
  Warehouse,
  VehicleType,
  Assignment,
  Metrics,
  ComparisonResult,
  TradeoffPoint,
  TradeoffResult,
  DemandShiftStats,
  FleetETAResult,
  ConstraintDiagnostics,
  FuelRates,
  CensusCity,
  CensusDemand,
  SimulationTickResult,
  ActiveSpill,
  LiveSnapshot,
  OverviewAggregate
} from '../types';

// In production (single Vercel deployment) API is same-origin at /api
// For split deployments, set VITE_API_URL to backend URL (e.g., https://hackmatics-grid-point-backend.vercel.app)
const API_BASE = (import.meta.env.VITE_API_URL as string) || '/api';

const TOKEN_KEY = 'gridpoint_auth_token';

export function getAuthToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setAuthToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* ignore */
  }
}

export function clearAuthToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const t = getAuthToken();
  return t ? { ...extra, Authorization: `Bearer ${t}` } : extra;
}

export interface AuthUser {
  id: string;
  name: string;
  email: string;
}

export interface AuthResponse {
  token: string;
  user: AuthUser;
}

async function parseAuthError(res: Response, fallback: string): Promise<never> {
  let msg = fallback;
  try {
    const data = await res.json();
    if (typeof data?.detail === 'string') msg = data.detail;
    else if (typeof data?.message === 'string') msg = data.message;
  } catch {
    /* keep fallback */
  }
  throw new Error(msg);
}

export async function signupUser(name: string, email: string, password: string): Promise<AuthResponse> {
  const res = await fetch(`${API_BASE}/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, email, password })
  });
  if (!res.ok) await parseAuthError(res, 'Signup failed');
  return await res.json();
}

export async function loginUser(email: string, password: string): Promise<AuthResponse> {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  if (!res.ok) await parseAuthError(res, 'Login failed');
  return await res.json();
}

export async function authMe(): Promise<AuthUser> {
  const res = await fetch(`${API_BASE}/auth/me`, {
    headers: authHeaders()
  });
  if (!res.ok) await parseAuthError(res, 'Session expired');
  return await res.json();
}

export async function validateOptimizationConfig(
  config: OptimizationConfig,
  neighborhoods: Neighborhood[]
): Promise<{ valid: boolean; errors: any[]; warnings: any[] }> {
  try {
    const res = await fetch(`${API_BASE}/config/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config, neighborhoods })
    });
    if (res.ok) {
      return await res.json();
    }
  } catch (e) {
    // Fallback to local validation
  }

  // Local fallback
  const errors: any[] = [];
  const warnings: any[] = [];
  if (config.K < 1 || config.K > 10) {
    errors.push({ field: 'K', error: 'K must be between 1 and 10', code: 'INVALID_K' });
  }
  if (neighborhoods.length > 0 && config.K > neighborhoods.length) {
    errors.push({ field: 'K', error: `K (${config.K}) cannot exceed dataset count (${neighborhoods.length})`, code: 'K_EXCEEDS_NODES' });
  }
  if (config.capacity_enabled && config.C_max != null) {
    const totalCap = config.K * config.C_max;
    const totalDemand = neighborhoods.reduce((sum, n) => sum + (Number(n.daily_orders) || 0), 0);
    if (totalCap < totalDemand) {
      errors.push({
        field: 'C_max',
        error: `Total capacity (${totalCap}) is less than total demand (${totalDemand}). Infeasible.`,
        code: 'TOTAL_CAPACITY_INSUFFICIENT'
      });
    }
  }
  return { valid: errors.length === 0, errors, warnings };
}

export async function validateData(neighborhoods: Neighborhood[]): Promise<ValidationResult> {
  try {
    const res = await fetch(`${API_BASE}/validate`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ neighborhoods })
    });
    if (!res.ok) throw new Error(`HTTP error ${res.status}`);
    return await res.json();
  } catch (err) {
    // Client-side fallback validation if API is unreachable
    return localValidate(neighborhoods);
  }
}

export async function fetchSynthetic(config: SyntheticConfig): Promise<Neighborhood[]> {
  const params = new URLSearchParams({
    N: config.N.toString(),
    lat_center: config.lat_center.toString(),
    lon_center: config.lon_center.toString(),
    spread_km: config.spread_km.toString(),
    distribution: config.distribution,
    num_clusters: config.num_clusters.toString(),
    orders_min: config.orders_min.toString(),
    orders_max: config.orders_max.toString(),
    seed: config.seed.toString()
  });

  try {
    const res = await fetch(`${API_BASE}/synthetic?${params.toString()}`);
    if (res.ok) return await res.json();
  } catch (e) {
    // Fallback
  }

  // Client-side synthetic generator fallback
  return localGenerateSynthetic(config);
}

// --------------------------------------------------------------------------
// US Census real demand (ACS tract populations, server-side key)
// --------------------------------------------------------------------------

export async function fetchCensusCities(): Promise<{ cities: CensusCity[]; key_configured: boolean }> {
  const res = await fetch(`${API_BASE}/census/cities`);
  if (!res.ok) throw new Error('Census service unreachable');
  return await res.json();
}

export async function fetchCensusDemand(cityId: string, ordersPer1000 = 5): Promise<CensusDemand> {
  const params = new URLSearchParams({ city: cityId, orders_per_1000: ordersPer1000.toString() });
  const res = await fetch(`${API_BASE}/census/demand?${params.toString()}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Census demand failed' }));
    throw new Error(apiErrorMessage(err, `Census demand failed (HTTP ${res.status})`));
  }
  return await res.json();
}

export async function uploadFile(file: File): Promise<{
  validation: ValidationResult;
  neighborhoods: Neighborhood[];
  summary: DatasetSummary;
}> {
  const formData = new FormData();
  formData.append('file', file);

  const res = await fetch(`${API_BASE}/upload?dataset=neighborhoods`, {
    method: 'POST',
    body: formData
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({ detail: 'Upload failed' }));
    throw new Error(apiErrorMessage(errorData, `Upload failed (HTTP ${res.status})`));
  }

  return await res.json();
}

export type OnboardingDataset = 'neighborhoods' | 'vehicles' | 'warehouses';

/** Generic onboarding upload: neighborhoods (default) + vehicles + warehouses (Phase A #4). */
export async function uploadDatasetFile(file: File, dataset: OnboardingDataset = 'neighborhoods'): Promise<any> {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch(`${API_BASE}/upload?dataset=${dataset}`, { method: 'POST', body: formData });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({ detail: 'Upload failed' }));
    throw new Error(apiErrorMessage(errorData, `Upload failed (HTTP ${res.status})`));
  }
  return await res.json();
}

// --------------------------------------------------------------------------
// Phase A — Onboarding Trio: owned vehicles + existing warehouses
// --------------------------------------------------------------------------

const SEED_VEHICLES: VehicleType[] = [
  { vehicle_type: 'bike', capacity: 20, cost_per_km: 4.0, fuel_type: 'petrol', avg_speed_kmph: 30, mileage_kmpl: 45 },
  { vehicle_type: 'van', capacity: 120, cost_per_km: 12.0, fuel_type: 'diesel', avg_speed_kmph: 40, mileage_kmpl: 14 },
  { vehicle_type: 'truck', capacity: 400, cost_per_km: 22.0, fuel_type: 'diesel', avg_speed_kmph: 35, mileage_kmpl: 6 },
  { vehicle_type: 'ev_van', capacity: 100, cost_per_km: 8.0, fuel_type: 'electric', avg_speed_kmph: 38, mileage_kmpl: 6.5 }
];

const SEED_WAREHOUSES: Warehouse[] = [
  { warehouse_id: 'EX-W1', latitude: 17.435, longitude: 78.486, capacity: 800, radius_km: 25, infra_cost: 1500, assigned_orders: 0 },
  { warehouse_id: 'EX-W2', latitude: 17.335, longitude: 78.536, capacity: 1200, radius_km: 25, infra_cost: 1750, assigned_orders: 0 }
];

/** Deterministic fleet seeder (seed=42). Falls back to a static fleet offline. */
export async function fetchSyntheticVehicles(seed = 42, count = 4): Promise<VehicleType[]> {
  try {
    const res = await fetch(`${API_BASE}/synthetic/vehicles?seed=${seed}&count=${count}`);
    if (res.ok) return await res.json();
  } catch { /* offline -> fallback */ }
  return SEED_VEHICLES.slice(0, Math.max(1, Math.min(count, SEED_VEHICLES.length)));
}

/** Deterministic existing-warehouse seeder (seed=42). Falls back to static sites offline. */
export async function fetchSyntheticWarehouses(seed = 42, count = 2, lat = 17.385044, lon = 78.486671): Promise<Warehouse[]> {
  try {
    const res = await fetch(
      `${API_BASE}/synthetic/warehouses?seed=${seed}&count=${count}&lat_center=${lat}&lon_center=${lon}`
    );
    if (res.ok) return await res.json();
  } catch { /* offline -> fallback */ }
  return SEED_WAREHOUSES.slice(0, Math.max(1, Math.min(count, SEED_WAREHOUSES.length)));
}

const ALLOWED_FUELS = ['petrol', 'diesel', 'cng', 'autogas', 'electric'];

export function localValidateVehicles(vehicles: VehicleType[]): ValidationResult {
  const errors: any[] = [];
  const seen = new Set<string>();
  if (!vehicles || vehicles.length === 0) {
    return { valid: false, errors: [{ field: 'dataset', error: 'Vehicle dataset is empty.', code: 'EMPTY_DATASET' }], warnings: [], total_rows: 0, valid_rows: 0 };
  }
  let validCount = 0;
  vehicles.forEach((v: any, idx) => {
    const row = idx + 1;
    let bad = false;
    if (!v.vehicle_type || String(v.vehicle_type).trim() === '') {
      errors.push({ row, field: 'vehicle_type', value: v.vehicle_type, error: 'vehicle_type is required', code: 'NULL_OR_EMPTY' });
      bad = true;
    } else if (seen.has(String(v.vehicle_type).toLowerCase())) {
      errors.push({ row, field: 'vehicle_type', value: v.vehicle_type, error: `Duplicate vehicle_type '${v.vehicle_type}'`, code: 'DUPLICATE_ID' });
      bad = true;
    } else {
      seen.add(String(v.vehicle_type).toLowerCase());
    }
    if (v.capacity == null || !Number.isInteger(Number(v.capacity)) || Number(v.capacity) <= 0) {
      errors.push({ row, field: 'capacity', value: v.capacity, error: 'capacity must be a positive integer', code: 'OUT_OF_RANGE' });
      bad = true;
    }
    if (v.cost_per_km == null || isNaN(Number(v.cost_per_km)) || Number(v.cost_per_km) < 0) {
      errors.push({ row, field: 'cost_per_km', value: v.cost_per_km, error: 'cost_per_km must be >= 0', code: 'OUT_OF_RANGE' });
      bad = true;
    }
    if (v.fuel_type && !ALLOWED_FUELS.includes(String(v.fuel_type).toLowerCase())) {
      errors.push({ row, field: 'fuel_type', value: v.fuel_type, error: `fuel_type must be one of ${ALLOWED_FUELS.join('/')}`, code: 'INVALID_FUEL_TYPE' });
      bad = true;
    }
    for (const f of ['avg_speed_kmph', 'mileage_kmpl'] as const) {
      const val = (v as any)[f];
      if (val != null && val !== '' && !(Number(val) > 0)) {
        errors.push({ row, field: f, value: val, error: `${f} must be > 0 when set`, code: 'OUT_OF_RANGE' });
        bad = true;
      }
    }
    if (!bad) validCount++;
  });
  return { valid: errors.length === 0, errors, warnings: [], total_rows: vehicles.length, valid_rows: validCount };
}

export function localValidateWarehouses(warehouses: Warehouse[]): ValidationResult {
  const errors: any[] = [];
  const seen = new Set<string>();
  if (!warehouses || warehouses.length === 0) {
    return { valid: false, errors: [{ field: 'dataset', error: 'Warehouse dataset is empty.', code: 'EMPTY_DATASET' }], warnings: [], total_rows: 0, valid_rows: 0 };
  }
  let validCount = 0;
  warehouses.forEach((w: any, idx) => {
    const row = idx + 1;
    let bad = false;
    if (!w.warehouse_id || String(w.warehouse_id).trim() === '') {
      errors.push({ row, field: 'warehouse_id', value: w.warehouse_id, error: 'warehouse_id is required', code: 'NULL_OR_EMPTY' });
      bad = true;
    } else if (seen.has(String(w.warehouse_id))) {
      errors.push({ row, field: 'warehouse_id', value: w.warehouse_id, error: `Duplicate warehouse_id '${w.warehouse_id}'`, code: 'DUPLICATE_ID' });
      bad = true;
    } else {
      seen.add(String(w.warehouse_id));
    }
    if (w.latitude == null || isNaN(Number(w.latitude)) || Number(w.latitude) < -90 || Number(w.latitude) > 90) {
      errors.push({ row, field: 'latitude', value: w.latitude, error: 'latitude must be in [-90, 90]', code: w.latitude == null ? 'NULL_VALUE' : 'OUT_OF_RANGE' });
      bad = true;
    }
    if (w.longitude == null || isNaN(Number(w.longitude)) || Number(w.longitude) < -180 || Number(w.longitude) > 180) {
      errors.push({ row, field: 'longitude', value: w.longitude, error: 'longitude must be in [-180, 180]', code: w.longitude == null ? 'NULL_VALUE' : 'OUT_OF_RANGE' });
      bad = true;
    }
    if (w.capacity != null && w.capacity !== '' && (!Number.isInteger(Number(w.capacity)) || Number(w.capacity) <= 0)) {
      errors.push({ row, field: 'capacity', value: w.capacity, error: 'capacity must be a positive integer when set', code: 'OUT_OF_RANGE' });
      bad = true;
    }
    if (w.radius_km != null && w.radius_km !== '' && !(Number(w.radius_km) > 0)) {
      errors.push({ row, field: 'radius_km', value: w.radius_km, error: 'radius_km must be > 0 when set', code: 'OUT_OF_RANGE' });
      bad = true;
    }
    if (w.infra_cost != null && w.infra_cost !== '' && !(Number(w.infra_cost) >= 0)) {
      errors.push({ row, field: 'infra_cost', value: w.infra_cost, error: 'infra_cost must be >= 0 when set', code: 'OUT_OF_RANGE' });
      bad = true;
    }
    if (!bad) validCount++;
  });
  return { valid: errors.length === 0, errors, warnings: [], total_rows: warehouses.length, valid_rows: validCount };
}

export async function validateVehicles(vehicles: VehicleType[]): Promise<ValidationResult> {
  try {
    const res = await fetch(`${API_BASE}/vehicles/validate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ vehicles })
    });
    if (res.ok) return await res.json();
  } catch { /* fallback */ }
  return localValidateVehicles(vehicles);
}

export async function validateWarehouses(warehouses: Warehouse[]): Promise<ValidationResult> {
  try {
    const res = await fetch(`${API_BASE}/warehouses/validate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ warehouses })
    });
    if (res.ok) return await res.json();
  } catch { /* fallback */ }
  return localValidateWarehouses(warehouses);
}

export async function exportCsv(neighborhoods: Neighborhood[]): Promise<string> {
  try {
    const res = await fetch(`${API_BASE}/export/csv`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ neighborhoods })
    });
    if (res.ok) return await res.text();
  } catch (e) {}

  const headers = ['neighborhood_id', 'name', 'latitude', 'longitude', 'daily_orders', 'zone'];
  const rows = neighborhoods.map(n => [
    n.neighborhood_id,
    `"${n.name || n.neighborhood_id}"`,
    n.latitude,
    n.longitude,
    n.daily_orders,
    `"${n.zone || ''}"`
  ].join(','));
  return [headers.join(','), ...rows].join('\n');
}

export async function exportJson(neighborhoods: Neighborhood[]): Promise<string> {
  return JSON.stringify(neighborhoods, null, 2);
}

export async function optimizeNetwork(
  neighborhoods: Neighborhood[],
  config: OptimizationConfig
): Promise<OptimizationResult> {
  try {
    const res = await fetch(`${API_BASE}/optimize`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ neighborhoods, config })
    });
    if (res.ok) {
      return await res.json();
    }
  } catch (e) {}

  // Fallback client-side optimization solver (Weiszfeld & Weighted K-Means in JS)
  return localOptimizeNetwork(neighborhoods, config);
}

export async function exportMetricsCsv(result: OptimizationResult): Promise<string> {
  try {
    const res = await fetch(`${API_BASE}/export/metrics`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ result })
    });
    if (res.ok) return await res.text();
  } catch (e) {}
  throw new Error('Metrics export unavailable offline — use dashboard CSV button');
}

export interface RouteGeometry {
  line: number[][];
  distance_km: number;
  duration_min: number | null;
  provider: string;
}

/**
 * Extract a human-readable message from any API error payload.
 * FastAPI validation failures arrive as {detail: [{loc, msg, type}, ...]} —
 * stringifying that array would render "[object Object], ..." in the UI.
 */
export function apiErrorMessage(err: unknown, fallback: string): string {
  if (typeof err === 'string' && err) return err;
  if (err && typeof err === 'object') {
    const detail = (err as { detail?: unknown }).detail;
    if (typeof detail === 'string' && detail) return detail;
    if (Array.isArray(detail)) {
      const parts = detail
        .map((d) => {
          if (typeof d === 'string') return d;
          if (d && typeof d === 'object') {
            const loc = Array.isArray((d as { loc?: unknown }).loc)
              ? ((d as { loc?: unknown[] }).loc as unknown[]).map(String).join('.')
              : '';
            const msg = String((d as { msg?: unknown }).msg ?? '');
            return loc ? `${loc}: ${msg}` : msg;
          }
          return '';
        })
        .filter(Boolean);
      if (parts.length > 0) return parts.slice(0, 5).join('; ');
    }
  }
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

/** Friendly fallback shown whenever road geometry is unavailable (Phase B #3).
 * The raw backend validator string (`Pair #0: expected {frm…}`) must NEVER
 * reach the map UI — every geometry failure maps to this notice and the map
 * falls back to straight displacement lines with a traced/total counter. */
export const ROAD_FALLBACK_NOTICE = 'Road path unavailable — showing straight line';

/** Map ANY route-geometry failure to the friendly notice (Phase B #3).
 * Raw backend validator strings (e.g. `Pair #0: expected {frm…}`) must NEVER
 * reach the map UI: anything technical-looking falls back to the notice. */
export function friendlyRouteError(err: unknown, fallback = ROAD_FALLBACK_NOTICE): string {
  const raw = err instanceof Error ? err.message : typeof err === 'string' ? err : apiErrorMessage(err, fallback);
  if (
    /pair\s*#\d*/i.test(raw) ||
    /\{frm/i.test(raw) ||
    /expected\s*\{/i.test(raw) ||
    /\[object\s*object\]/i.test(raw) ||
    /422|validation|unprocessable/i.test(raw)
  ) {
    return fallback;
  }
  // Any other geometry failure still gets a friendly, actionable message.
  if (/failed|shape|network|fetch|timeout|500|502|503/i.test(raw)) return fallback;
  // Last resort: anything resembling a validator/debug dump is swallowed too.
  if (/[{}\[\]#;]|expected|loc\.|undefined|NaN|object Object|Error:/i.test(raw)) return fallback;
  return raw || fallback;
}

/** Driving path per origin→destination pair (TomTom → OSRM → straight fallback). */
export async function fetchRouteGeometries(
  pairs: { from: { lat: number; lon: number }; to: { lat: number; lon: number } }[],
  liveTraffic = false
): Promise<RouteGeometry[]> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/routes/geometry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pairs, live_traffic: liveTraffic })
    });
  } catch {
    throw new Error(ROAD_FALLBACK_NOTICE);
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Route fetch failed' }));
    throw new Error(friendlyRouteError(apiErrorMessage(err, `Route fetch failed (HTTP ${res.status})`)));
  }
  let body: { routes?: unknown };
  try {
    body = (await res.json()) as { routes?: unknown };
  } catch {
    throw new Error(ROAD_FALLBACK_NOTICE);
  }
  if (!body || !Array.isArray(body.routes)) throw new Error(ROAD_FALLBACK_NOTICE);
  return body.routes as RouteGeometry[];
}

// --------------------------------------------------------------------------
// Phase B: coverage heatmap + warehouse focus + corridor traffic (display)
// --------------------------------------------------------------------------

export interface CoverageCell {
  lat: number;
  lon: number;
  distance_km: number;
  t: number;
  color: string;
}

export interface CoverageBounds {
  min_lat: number;
  max_lat: number;
  min_lon: number;
  max_lon: number;
}

export interface CoverageResult {
  cells: CoverageCell[];
  min_km: number;
  max_km: number;
  grid_n?: number;
  hotspots?: { neighborhood_id: string; distance_km: number; t: number; color: string }[];
  /** Padded city-wide bounds the grid covers (backend + local fallback). */
  bounds?: CoverageBounds;
  /** Per-cell step in degrees — clients render contiguous zone polygons. */
  cell_step?: { dlat: number; dlon: number };
}

export interface WarehouseFocusMember {
  neighborhood_id: string;
  name?: string;
  latitude: number;
  longitude: number;
  daily_orders: number;
  zone: string;
  distance_km: number;
  within_radius: boolean;
  is_feasible: boolean;
}

export interface WarehouseFocus {
  found: boolean;
  warehouse_id: string;
  center?: { lat: number; lon: number };
  assigned_orders?: number;
  neighborhood_count?: number;
  utilization_pct?: number | null;
  capacity?: number | null;
  radius_km?: number | null;
  infra_cost?: number;
  color?: string;
  avg_distance_km?: number;
  max_distance_km?: number;
  members?: WarehouseFocusMember[];
}

/** Green (near, t=0) → amber → red (far, t=1), mirroring backend mapping.proximity_color. */
export function proximityColor(t: number): string {
  const c = Math.max(0, Math.min(1, Number(t) || 0));
  const lerp = (a: number, b: number, f: number) => Math.round(a + (b - a) * f);
  let r: number; let g: number; let b: number;
  if (c < 0.5) {
    const f = c / 0.5;
    r = lerp(0x22, 0xf5, f); g = lerp(0xc5, 0x9e, f); b = lerp(0x5e, 0x0b, f);
  } else {
    const f = (c - 0.5) / 0.5;
    r = lerp(0xf5, 0xef, f); g = lerp(0x9e, 0x44, f); b = lerp(0x0b, 0x44, f);
  }
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

/** Corridor congestion bucket for the traffic overlay (fluid/busy/jammed). */
export function corridorBucket(congestionPct: number | null | undefined): 'fluid' | 'busy' | 'jammed' | 'unknown' {
  if (congestionPct == null || !Number.isFinite(Number(congestionPct))) return 'unknown';
  const v = Number(congestionPct);
  if (v < 0.15) return 'fluid';
  if (v < 0.4) return 'busy';
  return 'jammed';
}

/** Local coverage fallback (mirrors backend mapping.coverage_heatmap IDW grid,
 * including the padded city-wide bounds + cell step for zone rendering). */
export function computeCoverageCells(
  neighborhoods: Neighborhood[],
  assignments: Assignment[],
  gridN = 24,
  pad = 0.18
): CoverageResult {
  const nodes = neighborhoods.filter((n) => Number.isFinite(n.latitude) && Number.isFinite(n.longitude));
  if (nodes.length === 0) return { cells: [], min_km: 0, max_km: 0 };
  const distByNb = new Map(assignments.map((a) => [a.neighborhood_id, Number(a.distance_km) || 0]));
  const dists = nodes.map((n) => distByNb.get(n.neighborhood_id) ?? 0);
  const lo = Math.min(...dists);
  const hi = Math.max(...dists);
  const span = Math.max(1e-9, hi - lo);
  const lats = nodes.map((n) => n.latitude);
  const lons = nodes.map((n) => n.longitude);
  let minLat = Math.min(...lats); let maxLat = Math.max(...lats);
  let minLon = Math.min(...lons); let maxLon = Math.max(...lons);
  if (Math.abs(maxLat - minLat) < 1e-6) { minLat -= 0.02; maxLat += 0.02; }
  if (Math.abs(maxLon - minLon) < 1e-6) { minLon -= 0.02; maxLon += 0.02; }
  const padFrac = Math.max(0, Number(pad) || 0);
  const latSpan = maxLat - minLat;
  const lonSpan = maxLon - minLon;
  minLat -= Math.max(latSpan * padFrac, 0.02);
  maxLat += Math.max(latSpan * padFrac, 0.02);
  minLon -= Math.max(lonSpan * padFrac, 0.02);
  maxLon += Math.max(lonSpan * padFrac, 0.02);
  const n = Math.max(4, Math.min(64, Math.round(gridN) || 24));
  const stepLat = (maxLat - minLat) / n;
  const stepLon = (maxLon - minLon) / n;
  const cells: CoverageCell[] = [];
  for (let gi = 0; gi < n; gi++) {
    for (let gj = 0; gj < n; gj++) {
      const clat = minLat + ((maxLat - minLat) * (gi + 0.5)) / n;
      const clon = minLon + ((maxLon - minLon) * (gj + 0.5)) / n;
      let num = 0; let den = 0;
      nodes.forEach((nd, idx) => {
        const dlat = (nd.latitude - clat) * 111.0;
        const dlon = (nd.longitude - clon) * 111.0 * Math.cos((clat * Math.PI) / 180);
        const dd = Math.hypot(dlat, dlon);
        const w = 1 / (1 + dd);
        num += dists[idx] * w;
        den += w;
      });
      const mean = den > 0 ? num / den : 0;
      const t = Math.max(0, Math.min(1, (mean - lo) / span));
      cells.push({ lat: Math.round(clat * 1e5) / 1e5, lon: Math.round(clon * 1e5) / 1e5, distance_km: Math.round(mean * 100) / 100, t: Math.round(t * 1000) / 1000, color: proximityColor(t) });
    }
  }
  return {
    cells, min_km: Math.round(lo * 100) / 100, max_km: Math.round(hi * 100) / 100, grid_n: n,
    bounds: { min_lat: minLat, max_lat: maxLat, min_lon: minLon, max_lon: maxLon },
    cell_step: { dlat: stepLat, dlon: stepLon }
  };
}

/** Local focus fallback (mirrors backend mapping.warehouse_focus_summary). */
export function computeWarehouseFocus(
  warehouseId: string,
  neighborhoods: Neighborhood[],
  warehouses: Warehouse[],
  assignments: Assignment[]
): WarehouseFocus {
  const wh = warehouses.find((w) => w.warehouse_id === warehouseId);
  if (!wh) return { found: false, warehouse_id: warehouseId };
  const nbById = new Map(neighborhoods.map((n) => [n.neighborhood_id, n]));
  const members: WarehouseFocusMember[] = [];
  let total = 0;
  const dists: number[] = [];
  assignments.filter((a) => a.warehouse_id === warehouseId).forEach((a) => {
    const nb = nbById.get(a.neighborhood_id);
    const orders = Number(nb?.daily_orders) || 0;
    const d = Number(a.distance_km) || 0;
    total += orders;
    dists.push(d);
    members.push({
      neighborhood_id: a.neighborhood_id,
      name: nb?.name || a.neighborhood_id,
      latitude: Number(nb?.latitude),
      longitude: Number(nb?.longitude),
      daily_orders: orders,
      zone: (nb?.zone || 'Unzoned').trim() || 'Unzoned',
      distance_km: Math.round(d * 100) / 100,
      within_radius: a.within_radius,
      is_feasible: a.is_feasible
    });
  });
  members.sort((a, b) => a.distance_km - b.distance_km);
  let util: number | null = null;
  if (wh.capacity != null && Number(wh.capacity) > 0) util = Math.round((total / Number(wh.capacity)) * 1000) / 10;
  return {
    found: true,
    warehouse_id: warehouseId,
    center: { lat: wh.latitude, lon: wh.longitude },
    assigned_orders: total,
    neighborhood_count: members.length,
    utilization_pct: util ?? wh.utilization_pct ?? null,
    capacity: wh.capacity ?? null,
    radius_km: wh.radius_km ?? null,
    infra_cost: wh.infra_cost,
    avg_distance_km: dists.length ? Math.round((dists.reduce((s, v) => s + v, 0) / dists.length) * 100) / 100 : 0,
    max_distance_km: dists.length ? Math.round(Math.max(...dists) * 100) / 100 : 0,
    members
  };
}

/** Server coverage grid with local fallback (never throws — returns local grid). */
export async function fetchCoverage(
  neighborhoods: Neighborhood[],
  assignments: Assignment[],
  gridN = 24
): Promise<CoverageResult> {
  try {
    const res = await fetch(`${API_BASE}/map/coverage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ neighborhoods, assignments, grid_n: gridN })
    });
    if (res.ok) {
      const body = (await res.json()) as CoverageResult;
      if (body && Array.isArray(body.cells)) return body;
    }
  } catch { /* offline → local */ }
  return computeCoverageCells(neighborhoods, assignments, gridN);
}

/** Server focus payload with local fallback (never throws). */
export async function fetchWarehouseFocus(
  warehouseId: string,
  neighborhoods: Neighborhood[],
  warehouses: Warehouse[],
  assignments: Assignment[]
): Promise<WarehouseFocus> {
  try {
    const res = await fetch(`${API_BASE}/map/warehouse-focus`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ warehouse_id: warehouseId, neighborhoods, warehouses, assignments })
    });
    if (res.ok) {
      const body = (await res.json()) as WarehouseFocus;
      if (body && body.found) return body;
    }
  } catch { /* offline → local */ }
  return computeWarehouseFocus(warehouseId, neighborhoods, warehouses, assignments);
}

export interface IsoFeature {
  type: 'Feature';
  properties: { contour?: number; [k: string]: unknown };
  geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: unknown };
}

/**
 * Road-network service-area polygon(s) around a point via the Mapbox
 * Isochrone API (driving profile, travel-time contours along real roads).
 * `minutes` may hold 1-2 contours (e.g. [half, full]); response features
 * carry properties.contour (minutes, ascending). Throws on failure so
 * callers can fall back to straight-line radius circles.
 */
export async function fetchIsochrones(
  lon: number,
  lat: number,
  minutes: number[],
  token: string
): Promise<IsoFeature[]> {
  const mins = [...new Set(minutes.map((m) => Math.max(1, Math.min(60, Math.round(m)))))].sort((a, b) => a - b);
  const url =
    `https://api.mapbox.com/isochrone/v1/mapbox/driving/${lon},${lat}` +
    `?contours_minutes=${mins.join(',')}&polygons=true&denoise=1&access_token=${encodeURIComponent(token)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Isochrone fetch failed (HTTP ${res.status})`);
  const body = (await res.json()) as { features?: unknown };
  if (!body || !Array.isArray(body.features)) throw new Error('Isochrone service returned an unexpected shape.');
  return body.features as IsoFeature[];
}

export async function exportAssignmentsCsv(result: OptimizationResult): Promise<string> {
  try {
    const res = await fetch(`${API_BASE}/export/assignments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ result })
    });
    if (res.ok) return await res.text();
  } catch (e) {}
  throw new Error('Assignments export unavailable offline — use dashboard CSV button');
}

// --------------------------------------------------------------------------
// Live fuel prices (RapidAPI, server-side key, cached 12h)
// --------------------------------------------------------------------------

const FALLBACK_FUEL: FuelRates = {
  state: 'Karnataka',
  live: false,
  cities: [],
  defaults: { petrol: 105.0, diesel: 92.0, cng: 90.0, autogas: 40.0 }
};

/** Daily ₹/litre rates by city. Falls back to static defaults when offline/keyless. */
export async function fetchFuelRates(state = 'Karnataka'): Promise<FuelRates> {
  try {
    const res = await fetch(`${API_BASE}/fuel/rates?state=${encodeURIComponent(state)}`);
    if (res.ok) return await res.json();
  } catch (e) {
    // offline -> fallback below
  }
  return { ...FALLBACK_FUEL, state };
}

/** ₹/litre for a fuel type in a city (case-insensitive), else static default. */
export function fuelPriceFor(rates: FuelRates, fuelType: string, city?: string | null): { price: number; live: boolean; city: string | null } {
  const key = (fuelType || 'petrol').trim().toLowerCase() as keyof FuelRates['cities'][number];
  const match = city
    ? rates.cities.find((c) => c.city.trim().toLowerCase() === city.trim().toLowerCase())
    : undefined;
  const row = match || rates.cities[0];
  const livePrice = row ? (row[key] as unknown as number | null) : null;
  if (typeof livePrice === 'number' && livePrice > 0) {
    return { price: livePrice, live: rates.live, city: row.city };
  }
  return { price: rates.defaults[key as string] ?? 0, live: false, city: null };
}

// Client-side local validation fallback adhering to schema.md §4
export function localValidate(neighborhoods: Neighborhood[]): ValidationResult {
  const errors: any[] = [];
  const seenIds = new Set<string>();

  if (!neighborhoods || neighborhoods.length === 0) {
    return {
      valid: false,
      errors: [{
        field: 'dataset',
        error: 'Dataset is empty. At least 1 neighborhood record is required.',
        code: 'EMPTY_DATASET'
      }],
      warnings: [],
      total_rows: 0,
      valid_rows: 0
    };
  }

  let validCount = 0;

  neighborhoods.forEach((row, idx) => {
    const rowNum = idx + 1;
    let rowHasError = false;

    if (!row.neighborhood_id || String(row.neighborhood_id).trim() === '') {
      errors.push({
        row: rowNum,
        field: 'neighborhood_id',
        value: row.neighborhood_id,
        error: 'neighborhood_id is required',
        code: 'NULL_OR_EMPTY'
      });
      rowHasError = true;
    } else if (seenIds.has(String(row.neighborhood_id))) {
      errors.push({
        row: rowNum,
        field: 'neighborhood_id',
        value: row.neighborhood_id,
        error: `Duplicate neighborhood_id '${row.neighborhood_id}'`,
        code: 'DUPLICATE_ID'
      });
      rowHasError = true;
    } else {
      seenIds.add(String(row.neighborhood_id));
    }

    if (row.latitude == null || isNaN(Number(row.latitude))) {
      errors.push({
        row: rowNum,
        field: 'latitude',
        value: row.latitude,
        error: 'latitude is required',
        code: 'NULL_VALUE'
      });
      rowHasError = true;
    } else if (Number(row.latitude) < -90 || Number(row.latitude) > 90) {
      errors.push({
        row: rowNum,
        field: 'latitude',
        value: row.latitude,
        error: 'latitude must be in [-90, 90]',
        code: 'OUT_OF_RANGE'
      });
      rowHasError = true;
    }

    if (row.longitude == null || isNaN(Number(row.longitude))) {
      errors.push({
        row: rowNum,
        field: 'longitude',
        value: row.longitude,
        error: 'longitude is required',
        code: 'NULL_VALUE'
      });
      rowHasError = true;
    } else if (Number(row.longitude) < -180 || Number(row.longitude) > 180) {
      errors.push({
        row: rowNum,
        field: 'longitude',
        value: row.longitude,
        error: 'longitude must be in [-180, 180]',
        code: 'OUT_OF_RANGE'
      });
      rowHasError = true;
    }

    if (row.daily_orders == null || isNaN(Number(row.daily_orders))) {
      errors.push({
        row: rowNum,
        field: 'daily_orders',
        value: row.daily_orders,
        error: 'daily_orders is required',
        code: 'NULL_VALUE'
      });
      rowHasError = true;
    } else if (Number(row.daily_orders) < 0) {
      errors.push({
        row: rowNum,
        field: 'daily_orders',
        value: row.daily_orders,
        error: 'daily_orders must be >= 0',
        code: 'OUT_OF_RANGE'
      });
      rowHasError = true;
    }

    if (!rowHasError) validCount++;
  });

  return {
    valid: errors.length === 0,
    errors,
    warnings: [],
    total_rows: neighborhoods.length,
    valid_rows: validCount
  };
}

// Client-side synthetic generator fallback — mirrors the backend city model:
// dense core + inner districts (all bearings) + satellite hubs + outskirt
// fringe, with orders tapering away from the centre. Used only when the
// backend /api/synthetic endpoint is unreachable.
function localGenerateSynthetic(config: SyntheticConfig): Neighborhood[] {
  const nodes: Neighborhood[] = [];
  const spread = Math.max(1, config.spread_km);
  const latDegPerKm = 1 / 110.574;
  const lonDegPerKm = 1 / (111.32 * Math.max(0.1, Math.cos(config.lat_center * Math.PI / 180)));
  const COMPASS = ['North', 'North-East', 'East', 'South-East', 'South', 'South-West', 'West', 'North-West'];
  const CORE = ['Central Market', 'Old City', 'Grand Square', 'Metro Hub', 'Midtown'];
  const INNER = ['Green Hills', 'Riverside', 'Lakeview', 'Garden Colony', 'Mill Quarter'];
  const HUBS = ['Tech Park', 'Cyber City', 'Logistics Park', 'IT Corridor'];
  const FRINGE = ['Green Belt', 'Outer Ring Village', 'Rural Fringe', 'Satellite Town'];

  const gauss = () => (Math.random() + Math.random() + Math.random()) / 1.5 - 1; // ~N(0, ~0.47)
  const district = (bearing: number, inner: boolean) => {
    const deg = ((bearing * 180 / Math.PI) % 360 + 360) % 360;
    return `${inner ? 'Inner' : 'Outer'} ${COMPASS[Math.floor((deg + 22.5) / 45) % 8]}`;
  };
  const taper = (frac: number) => {
    const span = Math.max(1, config.orders_max - config.orders_min);
    const v = Math.round(config.orders_max - Math.min(1, Math.max(0, frac)) * span * 0.9 + (Math.random() - 0.5) * 0.3 * span);
    return Math.min(config.orders_max, Math.max(config.orders_min, v));
  };
  const push = (idx: number, distKm: number, bearing: number, zone: string, name: string, frac: number) => {
    nodes.push({
      neighborhood_id: `N${String(idx + 1).padStart(3, '0')}`,
      name,
      latitude: parseFloat((config.lat_center + distKm * Math.cos(bearing) * latDegPerKm).toFixed(6)),
      longitude: parseFloat((config.lon_center + distKm * Math.sin(bearing) * lonDegPerKm).toFixed(6)),
      daily_orders: taper(frac),
      zone
    });
  };

  if (config.distribution === 'uniform') {
    for (let i = 0; i < config.N; i++) {
      const r = spread * Math.sqrt(Math.random());
      const b = Math.random() * 2 * Math.PI;
      push(i, r, b, district(b, r < 0.5 * spread), INNER[i % INNER.length], r / spread);
    }
    return nodes;
  }
  if (config.distribution === 'gaussian') {
    for (let i = 0; i < config.N; i++) {
      const lat = config.lat_center + gauss() * (spread / 3) * latDegPerKm;
      const lon = config.lon_center + gauss() * (spread / 3) * lonDegPerKm;
      const frac = Math.min(1, Math.hypot((lat - config.lat_center) / latDegPerKm, (lon - config.lon_center) / lonDegPerKm) / spread);
      nodes.push({
        neighborhood_id: `N${String(i + 1).padStart(3, '0')}`,
        name: CORE[i % CORE.length],
        latitude: parseFloat(lat.toFixed(6)),
        longitude: parseFloat(lon.toFixed(6)),
        daily_orders: taper(frac),
        zone: 'Central-Zone'
      });
    }
    return nodes;
  }

  // City model (clustered): core + inner disc + satellite hubs + fringe + centre anchors
  const n = config.N;
  const nCore = Math.max(2, Math.round(n * 0.25));
  const nInner = Math.max(2, Math.round(n * 0.4));
  const nFringe = Math.max(1, Math.round(n * 0.1));
  const nHubs = Math.max(0, n - nCore - nInner - nFringe);
  const kHubs = Math.max(1, Math.min(config.num_clusters, Math.max(1, nHubs)));
  const hubBearings = Array.from({ length: kHubs }, (_, h) => (2 * Math.PI * h) / kHubs + (Math.random() - 0.5) * 0.6);
  const hubDists = hubBearings.map(() => (0.55 + Math.random() * 0.25) * spread);
  let i = 0;
  for (let c = 0; c < nCore && i < n; c++, i++) {
    const r = Math.abs(gauss()) * 0.12 * spread;
    const b = Math.random() * 2 * Math.PI;
    push(i, r, b, 'City Centre', CORE[i % CORE.length], r / spread);
  }
  for (let c = 0; c < nInner && i < n; c++, i++) {
    const r = spread * Math.sqrt(0.02 + Math.random() * 0.34);
    const b = Math.random() * 2 * Math.PI;
    push(i, r, b, district(b, true), INNER[i % INNER.length], r / spread);
  }
  for (let c = 0; c < nHubs && i < n; c++, i++) {
    const h = c % kHubs;
    const r = hubDists[h] + gauss() * 0.1 * spread;
    push(i, Math.max(0, r), hubBearings[h], `${HUBS[h % HUBS.length]} Hub`, HUBS[i % HUBS.length], Math.max(0, r) / spread);
  }
  for (let c = 0; c < nFringe && i < n; c++, i++) {
    const r = (0.65 + Math.random() * 0.35) * spread;
    const b = Math.random() * 2 * Math.PI;
    push(i, r, b, district(b, false), FRINGE[i % FRINGE.length], r / spread);
  }
  while (i < n) { // safety fill (rounding): inner disc
    const r = spread * Math.sqrt(Math.random() * 0.36);
    const b = Math.random() * 2 * Math.PI;
    push(i, r, b, district(b, true), INNER[i % INNER.length], r / spread);
    i++;
  }
  // Anchor nodes guarantee centre coverage
  const anchors = Math.min(3, nodes.length);
  for (let a = 0; a < anchors; a++) {
    const r = (0.02 + Math.random() * 0.06) * spread;
    const b = Math.random() * 2 * Math.PI;
    nodes[a] = {
      ...nodes[a],
      latitude: parseFloat((config.lat_center + r * Math.cos(b) * latDegPerKm).toFixed(6)),
      longitude: parseFloat((config.lon_center + r * Math.sin(b) * lonDegPerKm).toFixed(6)),
      zone: 'City Centre',
      name: CORE[a % CORE.length],
      daily_orders: taper(r / spread)
    };
  }
  return nodes;
}

// Client-side Haversine distance in km
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371.0088;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Client-side optimization fallback
function localOptimizeNetwork(
  neighborhoods: Neighborhood[],
  config: OptimizationConfig
): OptimizationResult {
  if (!neighborhoods || neighborhoods.length === 0) {
    throw new Error('No neighborhoods loaded — upload data, generate a synthetic set, or load the sample first.');
  }
  const N = neighborhoods.length;
  const K = Math.min(config.K, N);

  // Initial seeds: pick K spread-out nodes
  const step = Math.floor(N / K);
  const warehouseCoords: { lat: number; lon: number }[] = [];
  for (let k = 0; k < K; k++) {
    const idx = Math.min(k * step, N - 1);
    warehouseCoords.push({
      lat: neighborhoods[idx].latitude,
      lon: neighborhoods[idx].longitude
    });
  }

  // Run 10 iterations of weighted clustering
  for (let iter = 0; iter < 10; iter++) {
    const clusterWeights = new Array(K).fill(0);
    const clusterLatSums = new Array(K).fill(0);
    const clusterLonSums = new Array(K).fill(0);

    for (const node of neighborhoods) {
      let bestK = 0;
      let minDist = Infinity;
      for (let k = 0; k < K; k++) {
        const d = haversineKm(node.latitude, node.longitude, warehouseCoords[k].lat, warehouseCoords[k].lon);
        if (d < minDist) {
          minDist = d;
          bestK = k;
        }
      }
      const w = Number(node.daily_orders) || 1;
      clusterWeights[bestK] += w;
      clusterLatSums[bestK] += node.latitude * w;
      clusterLonSums[bestK] += node.longitude * w;
    }

    for (let k = 0; k < K; k++) {
      if (clusterWeights[k] > 0) {
        warehouseCoords[k].lat = clusterLatSums[k] / clusterWeights[k];
        warehouseCoords[k].lon = clusterLonSums[k] / clusterWeights[k];
      }
    }
  }

  // Build assignments & metrics
  const warehouses: Warehouse[] = warehouseCoords.map((wc, idx) => ({
    warehouse_id: `W${idx + 1}`,
    latitude: parseFloat(wc.lat.toFixed(6)),
    longitude: parseFloat(wc.lon.toFixed(6)),
    capacity: config.capacity_enabled ? config.C_max : null,
    radius_km: config.radius_enabled ? config.R_max_km : null,
    infra_cost: config.infra_cost_per_warehouse,
    assigned_orders: 0
  }));

  const assignments: Assignment[] = [];
  let totalWeightedDist = 0;
  let totalUnweightedDist = 0;
  let totalCost = 0;
  let totalFuelCost = 0;
  let infeasibleCount = 0;

  neighborhoods.forEach((node) => {
    let bestK = 0;
    let minDist = Infinity;
    for (let k = 0; k < K; k++) {
      const d = haversineKm(node.latitude, node.longitude, warehouses[k].latitude, warehouses[k].longitude);
      if (d < minDist) {
        minDist = d;
        bestK = k;
      }
    }
    const w = Number(node.daily_orders) || 0;
    const weightedD = w * minDist;
    const cost = weightedD * config.cost_per_km + (weightedD * config.fuel_cost_per_km);
    const fuelCost = weightedD * config.fuel_cost_per_km;
    const withinRadius = config.radius_enabled && config.R_max_km ? minDist <= config.R_max_km : true;
    if (!withinRadius) infeasibleCount++;

    assignments.push({
      neighborhood_id: node.neighborhood_id,
      warehouse_id: warehouses[bestK].warehouse_id,
      distance_km: parseFloat(minDist.toFixed(2)),
      weighted_distance: parseFloat(weightedD.toFixed(2)),
      cost: parseFloat(cost.toFixed(2)),
      within_radius: withinRadius,
      is_feasible: withinRadius
    });

    warehouses[bestK].assigned_orders = (warehouses[bestK].assigned_orders || 0) + w;
    totalUnweightedDist += minDist;
    totalWeightedDist += weightedD;
    totalCost += cost;
    totalFuelCost += fuelCost;
  });

  const totalDemand = neighborhoods.reduce((sum, n) => sum + (Number(n.daily_orders) || 0), 0);

  const metrics: Metrics = {
    total_unweighted_distance_km: parseFloat(totalUnweightedDist.toFixed(2)),
    total_weighted_distance_km_orders: parseFloat(totalWeightedDist.toFixed(2)),
    total_cost: parseFloat((totalCost + K * config.infra_cost_per_warehouse).toFixed(2)),
    total_fuel_cost: parseFloat(totalFuelCost.toFixed(2)),
    fuel_live: false,
    avg_distance_per_order_km: parseFloat((totalWeightedDist / Math.max(1, totalDemand)).toFixed(2)),
    avg_weighted_distance_km: parseFloat((totalWeightedDist / Math.max(1, N)).toFixed(2)),
    warehouses: warehouses.map(w => ({
      warehouse_id: w.warehouse_id,
      assigned_orders: w.assigned_orders || 0,
      utilization_pct: config.capacity_enabled && config.C_max ? parseFloat(((w.assigned_orders || 0) / config.C_max * 100).toFixed(1)) : null,
      avg_distance_km: 0,
      neighborhood_count: assignments.filter(a => a.warehouse_id === w.warehouse_id).length
    })),
    infeasible_assignments: infeasibleCount,
    feasibility_ratio: parseFloat(((N - infeasibleCount) / Math.max(1, N)).toFixed(4))
  };

  // Baseline comparison (bounding box center)
  const lats = neighborhoods.map(n => n.latitude);
  const lons = neighborhoods.map(n => n.longitude);
  const baseLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const baseLon = (Math.min(...lons) + Math.max(...lons)) / 2;

  let baseWeightedDist = 0;
  let baseUnweightedDist = 0;
  neighborhoods.forEach((node) => {
    const d = haversineKm(node.latitude, node.longitude, baseLat, baseLon);
    const w = Number(node.daily_orders) || 0;
    baseUnweightedDist += d;
    baseWeightedDist += w * d;
  });
  const baseCost = baseWeightedDist * config.cost_per_km + (baseWeightedDist * config.fuel_cost_per_km) + config.infra_cost_per_warehouse;
  const baseFuelCost = baseWeightedDist * config.fuel_cost_per_km;

  const distSaved = Math.max(0, baseWeightedDist - totalWeightedDist);
  const costSaved = Math.max(0, baseCost - metrics.total_cost);

  const comparison: ComparisonResult = {
    baseline: {
      metrics: {
        total_unweighted_distance_km: parseFloat(baseUnweightedDist.toFixed(2)),
        total_weighted_distance_km_orders: parseFloat(baseWeightedDist.toFixed(2)),
        total_cost: parseFloat(baseCost.toFixed(2)),
        total_fuel_cost: parseFloat(baseFuelCost.toFixed(2)),
        fuel_live: false,
        avg_distance_per_order_km: parseFloat((baseWeightedDist / Math.max(1, totalDemand)).toFixed(2)),
        avg_weighted_distance_km: parseFloat((baseWeightedDist / Math.max(1, N)).toFixed(2)),
        warehouses: [{ warehouse_id: 'W_BASE', assigned_orders: totalDemand, avg_distance_km: 0, neighborhood_count: N }],
        infeasible_assignments: 0,
        feasibility_ratio: 1.0
      },
      warehouses: [{ warehouse_id: 'W_BASE', latitude: baseLat, longitude: baseLon }],
      assignments: []
    },
    optimized: {
      metrics,
      warehouses,
      assignments
    },
    delta: {
      distance_saved_km: parseFloat(Math.max(0, baseUnweightedDist - totalUnweightedDist).toFixed(2)),
      weighted_distance_saved: parseFloat(distSaved.toFixed(2)),
      cost_saved: parseFloat(costSaved.toFixed(2)),
      pct_distance_saved: parseFloat((distSaved / Math.max(0.001, baseWeightedDist) * 100).toFixed(2)),
      pct_cost_saved: parseFloat((costSaved / Math.max(0.001, baseCost) * 100).toFixed(2))
    }
  };

  return {
    config,
    warehouses,
    assignments,
    metrics,
    comparison,
    is_feasible: infeasibleCount === 0,
    infeasibility_reason: infeasibleCount > 0 ? `${infeasibleCount} assignments exceed radius limit` : null,
    routing_note: config.distance_metric === 'road'
      ? 'Offline fallback: straight-line distances (backend unreachable)'
      : undefined
  };
}

// --------------------------------------------------------------------------
// Phase 5: Scenario & Bonus API Methods with Local Fallbacks
// --------------------------------------------------------------------------

export async function getTradeoffCurve(
  neighborhoods: Neighborhood[],
  config: OptimizationConfig,
  max_k: number = 6
): Promise<TradeoffResult> {
  try {
    const res = await fetch(`${API_BASE}/scenarios/tradeoff`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ neighborhoods, config, max_k })
    });
    if (res.ok) {
      return await res.json();
    }
  } catch (e) {
    // network failure -> fallback to local simulation
  }

  // Local fallback: simulate for each K = 1..max_k
  const points: TradeoffPoint[] = [];
  const maxK = Math.max(1, Math.min(max_k, neighborhoods.length, 8));
  let bestK = 1;
  let minCost = Infinity;

  const infraCost = config.infra_cost_per_warehouse || 0;

  for (let k = 1; k <= maxK; k++) {
    const tempConfig: OptimizationConfig = { ...config, K: k };
    const opt = localOptimizeNetwork(neighborhoods, tempConfig);

    const deliveryCost = opt.assignments.reduce((sum, a) => sum + a.cost, 0);
    const infra = k * infraCost;
    const total = deliveryCost + infra;

    points.push({
      K: k,
      delivery_cost: parseFloat(deliveryCost.toFixed(2)),
      infra_cost: parseFloat(infra.toFixed(2)),
      total_cost: parseFloat(total.toFixed(2)),
      avg_distance_km: opt.metrics.avg_distance_per_order_km,
      pct_cost_saved: opt.comparison ? opt.comparison.delta.pct_cost_saved : 0,
      is_feasible: opt.is_feasible
    });

    if (total < minCost) {
      minCost = total;
      bestK = k;
    }
  }

  return {
    points,
    optimal_K: bestK,
    min_cost: parseFloat(minCost.toFixed(2))
  };
}

export async function applyDemandShift(
  neighborhoods: Neighborhood[],
  pct_delta: number
): Promise<{ neighborhoods: Neighborhood[]; stats: DemandShiftStats }> {
  try {
    const res = await fetch(`${API_BASE}/scenarios/demand-shift`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ neighborhoods, pct_delta })
    });
    if (res.ok) {
      return await res.json();
    }
  } catch (e) {
    // fallback
  }

  // Local fallback
  const multiplier = 1.0 + (pct_delta / 100.0);
  let origTotal = 0;
  let newTotal = 0;

  const shifted = neighborhoods.map(n => {
    const orig = Number(n.daily_orders) || 0;
    origTotal += orig;
    let next = Math.max(0, Math.round(orig * multiplier));
    if (orig > 0 && next === 0 && multiplier > 0) next = 1;
    newTotal += next;
    return {
      ...n,
      daily_orders: next
    };
  });

  return {
    neighborhoods: shifted,
    stats: {
      pct_delta,
      original_total_orders: origTotal,
      new_total_orders: newTotal,
      net_order_change: newTotal - origTotal,
      actual_pct_change: parseFloat((((newTotal - origTotal) / Math.max(1, origTotal)) * 100).toFixed(1))
    }
  };
}

export async function getFleetETA(
  assignments: Assignment[],
  config: OptimizationConfig,
  vehicle_type?: string,
  opts?: { warehouses?: Warehouse[]; useLiveFeeds?: boolean; congestionOverrides?: Record<string, number> | null }
): Promise<FleetETAResult> {
  try {
    const res = await fetch(`${API_BASE}/scenarios/eta`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        assignments,
        config,
        vehicle_type,
        warehouses: opts?.warehouses ?? [],
        use_live_feeds: opts?.useLiveFeeds ?? null,
        congestion_overrides: opts?.congestionOverrides ?? null
      })
    });
    if (res.ok) {
      return await res.json();
    }
  } catch (e) {
    // fallback
  }

  // Local fallback
  const traffic = config.traffic_factor || 0;
  const speed = 35.0; // default km/h
  const capacity = 100;

  let totalEffectiveKm = 0;
  let totalTrips = 0;
  const etas: number[] = [];

  for (const a of assignments) {
    const dEff = a.distance_km * (1.0 + traffic);
    totalEffectiveKm += dEff;
    const hours = dEff / Math.max(5.0, speed);
    etas.push(hours * 60);

    const approxOrders = a.distance_km > 0 ? Math.round(a.weighted_distance / a.distance_km) : 1;
    totalTrips += Math.ceil(approxOrders / Math.max(1, capacity));
  }

  const avgEta = etas.length > 0 ? etas.reduce((s, e) => s + e, 0) / etas.length : 0;
  const maxEta = etas.length > 0 ? Math.max(...etas) : 0;
  const fuelLiters = totalEffectiveKm * 0.08;

  return {
    avg_eta_minutes: parseFloat(avgEta.toFixed(1)),
    max_eta_minutes: parseFloat(maxEta.toFixed(1)),
    total_trips: totalTrips,
    effective_km: parseFloat(totalEffectiveKm.toFixed(1)),
    fuel_consumed_liters: parseFloat(fuelLiters.toFixed(1)),
    vehicle_used: vehicle_type || 'Delivery Van',
    avg_speed_kmph: speed,
    traffic_congestion_pct: parseFloat((traffic * 100).toFixed(1))
  };
}

export async function getConstraintDiagnostics(
  warehouses: Warehouse[],
  assignments: Assignment[],
  config: OptimizationConfig
): Promise<ConstraintDiagnostics> {
  try {
    const res = await fetch(`${API_BASE}/scenarios/diagnostics`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ warehouses, assignments, config })
    });
    if (res.ok) {
      return await res.json();
    }
  } catch (e) {
    // fallback
  }

  // Local fallback
  const capViolations: any[] = [];
  const radViolations: any[] = [];
  const cMax = config.capacity_enabled ? config.C_max : null;
  const rMax = config.radius_enabled ? config.R_max_km : null;

  for (const w of warehouses) {
    const assigned = w.assigned_orders || 0;
    if (cMax && assigned > cMax) {
      const overflow = assigned - cMax;
      capViolations.push({
        warehouse_id: w.warehouse_id,
        assigned_orders: assigned,
        capacity: cMax,
        overflow_orders: overflow,
        utilization_pct: parseFloat((assigned / cMax * 100).toFixed(1)),
        severity: overflow > (0.25 * cMax) ? 'CRITICAL' : 'WARNING'
      });
    }
  }

  for (const a of assignments) {
    if (rMax && a.distance_km > rMax) {
      const overage = a.distance_km - rMax;
      radViolations.push({
        neighborhood_id: a.neighborhood_id,
        warehouse_id: a.warehouse_id,
        distance_km: parseFloat(a.distance_km.toFixed(2)),
        r_max_km: parseFloat(rMax.toFixed(2)),
        overage_km: parseFloat(overage.toFixed(2)),
        severity: overage > 10 ? 'CRITICAL' : 'WARNING'
      });
    }
  }

  return {
    is_compliant: capViolations.length === 0 && radViolations.length === 0,
    capacity_enabled: Boolean(config.capacity_enabled),
    radius_enabled: Boolean(config.radius_enabled),
    capacity_violations: capViolations,
    radius_violations: radViolations,
    total_violations: capViolations.length + radViolations.length
  };
}

// --------------------------------------------------------------------------
// Phase F: Realtime Automation & Overview with Local Fallbacks
// --------------------------------------------------------------------------

export interface SimulationTickArgs {
  neighborhoods: Neighborhood[];
  warehouses: Warehouse[];
  assignments: Assignment[];
  config: OptimizationConfig;
  tick: number;
  active_spills?: Record<string, ActiveSpill>;
  congestion_overrides?: Record<string, number> | null;
  scale_demand?: boolean;
  demand_amplitude?: number;
  simulate_surge?: boolean;
}

function localDemandWave(neighborhoods: Neighborhood[], tick: number): Neighborhood[] {
  const mult = 1.0 + 0.12 * Math.sin(tick / 2.5);
  return neighborhoods.map((n) => {
    const orig = Number(n.daily_orders) || 0;
    let h = 0;
    const s = `${n.neighborhood_id}@${tick}`;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    const jitter = ((h % 2000) / 10000) - 0.1;
    const next = Math.max(0, Math.round(orig * Math.max(0.2, mult + jitter)));
    return { ...n, daily_orders: orig > 0 && next === 0 ? 1 : next };
  });
}

export async function runSimulationTick(args: SimulationTickArgs): Promise<SimulationTickResult> {
  try {
    const res = await fetch(`${API_BASE}/simulation/tick`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        neighborhoods: args.neighborhoods,
        warehouses: args.warehouses,
        assignments: args.assignments,
        config: args.config,
        tick: args.tick,
        active_spills: args.active_spills || {},
        congestion_overrides: args.congestion_overrides ?? null,
        scale_demand: args.scale_demand ?? true,
        demand_amplitude: args.demand_amplitude ?? 1.0,
        simulate_surge: args.simulate_surge ?? true
      })
    });
    if (res.ok) return await res.json();
  } catch (e) {
    // offline -> local fallback below
  }
  // Local fallback: demand wave + threshold spillover on manual floor
  const live = args.config.simulation_mode === 'realtime' && (args.scale_demand ?? true);
  const scaled = live ? localDemandWave(args.neighborhoods, args.tick) : args.neighborhoods;
  const threshold = args.config.simulation_congestion_threshold ?? 0.5;
  const floor = args.config.traffic_factor || 0;
  const congestion: Record<string, number> = {};
  (args.warehouses || []).forEach((w) => {
    congestion[w.warehouse_id] = args.congestion_overrides?.[w.warehouse_id] ?? floor;
  });
  const spills = { ...(args.active_spills || {}) };
  const events: SimulationTickResult['events'] = [];
  const next = args.assignments.map((a) => ({ ...a }));
  Object.keys(congestion).forEach((wid) => {
    if (!spills[wid] && congestion[wid] >= threshold) {
      const moved = next.filter((a) => a.warehouse_id === wid).map((a) => a.neighborhood_id);
      if (moved.length > 0) {
        const others = args.warehouses.filter((w) => w.warehouse_id !== wid);
        next.forEach((a) => {
          if (a.warehouse_id === wid && others.length > 0) a.warehouse_id = others[0].warehouse_id;
        });
        spills[wid] = { warehouse_id: wid, since_tick: args.tick, moved_neighborhood_ids: moved, original_warehouse: Object.fromEntries(moved.map((m) => [m, wid])) };
        events.push({ tick: args.tick, warehouse_id: wid, congestion_pct: congestion[wid], moved_neighborhood_ids: moved, kind: 'spill_start', reason: `Offline fallback: congestion ${(congestion[wid] * 100).toFixed(0)}% >= ${(threshold * 100).toFixed(0)}%` });
      }
    }
  });
  return {
    tick: args.tick,
    simulation_mode: args.config.simulation_mode || 'off',
    neighborhoods: scaled,
    assignments: next,
    metrics: null,
    congestion_by_warehouse: congestion,
    congestion_live: Object.fromEntries(Object.keys(congestion).map((k) => [k, false])),
    events,
    active_spills: spills,
    demand_note: live ? `Offline fallback demand wave tick=${args.tick}` : 'Simulation off — demand frozen (manual overrides only)',
    traffic_note: 'Offline fallback: manual traffic floor (backend unreachable)',
    fuel_note: 'Offline fallback: static fuel rates'
  };
}

export async function fetchLiveSnapshot(
  neighborhoods: Neighborhood[],
  warehouses: Warehouse[],
  config: OptimizationConfig
): Promise<LiveSnapshot> {
  try {
    const res = await fetch(`${API_BASE}/simulation/live`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ neighborhoods, warehouses, config })
    });
    if (res.ok) return await res.json();
  } catch (e) {
    // offline -> fallback below
  }
  const total = neighborhoods.reduce((s, n) => s + (Number(n.daily_orders) || 0), 0);
  const by: Record<string, number> = {};
  warehouses.forEach((w) => { by[w.warehouse_id] = config.traffic_factor || 0; });
  return {
    at: Date.now() / 1000,
    fuel: { prices: { petrol: 105, diesel: 92, cng: 90, autogas: 40 }, live: false, note: 'Offline fallback: static fuel rates', city: config.fuel_city ?? null, state: config.fuel_state || 'Karnataka' },
    traffic: { by_warehouse: by, live: Object.fromEntries(Object.keys(by).map((k) => [k, false])), avg_congestion_pct: config.traffic_factor || 0, note: 'Offline fallback: manual traffic floor' },
    demand: { nodes: neighborhoods.length, total_orders: total }
  };
}

export async function fetchOverview(
  neighborhoods: Neighborhood[],
  warehouses: Warehouse[],
  assignments: Assignment[],
  config: OptimizationConfig,
  active_spills?: Record<string, ActiveSpill>
): Promise<OverviewAggregate> {
  try {
    const res = await fetch(`${API_BASE}/overview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ neighborhoods, warehouses, assignments, config, active_spills: active_spills || {} })
    });
    if (res.ok) return await res.json();
  } catch (e) {
    // offline -> fallback below
  }
  const mix: Record<string, number> = {};
  (config.vehicle_fleet || []).forEach((v) => {
    mix[v.vehicle_type] = (mix[v.vehicle_type] || 0) + 1;
  });
  const totalOrders = neighborhoods.reduce((s, n) => s + (Number(n.daily_orders) || 0), 0);
  const perWh = config.infra_cost_per_warehouse || 0;
  const feas = assignments.length > 0 ? assignments.filter((a) => a.is_feasible).length / assignments.length : 1;
  return {
    vehicle_count: (config.vehicle_fleet || []).length,
    vehicle_mix: mix,
    fuel_price: { prices: { petrol: 105, diesel: 92, cng: 90, autogas: 40 }, live: false, note: 'Offline fallback: static fuel rates', city: config.fuel_city ?? null, state: config.fuel_state || 'Karnataka' },
    infra_price: { per_warehouse: perWh, total: perWh * warehouses.length },
    warehouse_count: warehouses.length,
    utilization: warehouses.map((w) => w.utilization_pct ?? null),
    order_totals: { nodes: neighborhoods.length, daily_orders: totalOrders },
    distance_cost: {
      total_weighted_distance_km_orders: assignments.reduce((s, a) => s + (a.weighted_distance || 0), 0),
      total_cost: assignments.reduce((s, a) => s + (a.cost || 0), 0),
      total_fuel_cost: assignments.reduce((s, a) => s + (a.fuel_cost || 0), 0),
      avg_congestion_pct: config.traffic_factor || 0,
      avg_distance_per_order_km: totalOrders > 0 ? assignments.reduce((s, a) => s + (a.weighted_distance || 0), 0) / totalOrders : 0,
      feasibility_ratio: feas,
      fuel_live: false
    },
    alerts: [],
    at: Date.now() / 1000
  };
}

// --------------------------------------------------------------------------
// Phase C: traffic-aware routing (corridor traffic + dynamic reroute)
// --------------------------------------------------------------------------

export interface CorridorInfo {
  factor: number;
  live: boolean;
  samples: number;
  points: number;
  avg_delay: number;
}

export interface CorridorTrafficResult {
  corridors: Record<string, CorridorInfo>;
  factors: Record<string, number>;
  avg_congestion_pct: number;
  live_corridors: number;
  total_corridors: number;
  note: string;
}

export interface RerouteResult {
  assignments: Assignment[];
  warehouses: Warehouse[];
  metrics: Metrics;
  changed: number;
  moved_neighborhood_ids: string[];
  saved_cost: number;
  saved_minutes: number;
  old_cost: number;
  new_cost: number;
  old_minutes: number;
  new_minutes: number;
  alpha: number;
  beta_per_min: number;
  traffic_note: string;
  fuel_note?: string | null;
  routing_note?: string | null;
}

/** Per-corridor congestion from traced road geometries (server + history). */
export async function fetchCorridorTraffic(
  neighborhoods: Neighborhood[],
  warehouses: Warehouse[],
  assignments: Assignment[],
  opts?: { hour?: number | null; useLive?: boolean }
): Promise<CorridorTrafficResult | null> {
  try {
    const res = await fetch(`${API_BASE}/traffic/corridors`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        neighborhoods,
        warehouses,
        assignments,
        hour: opts?.hour ?? null,
        use_live: opts?.useLive ?? true
      })
    });
    if (res.ok) return await res.json();
  } catch {
    /* offline → null; callers fall back to assignment congestion */
  }
  return null;
}

export interface RerouteArgs {
  neighborhoods: Neighborhood[];
  warehouses: Warehouse[];
  assignments: Assignment[];
  config: OptimizationConfig;
  alpha?: number;
  beta_per_min?: number;
  congestion_overrides?: Record<string, number> | null;
}

/** Re-evaluate assignment on current corridor traffic (α·cost + β·time). */
export async function rerouteOnTraffic(args: RerouteArgs): Promise<RerouteResult> {
  const res = await fetch(`${API_BASE}/routes/reroute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      neighborhoods: args.neighborhoods,
      warehouses: args.warehouses,
      assignments: args.assignments,
      config: args.config,
      alpha: args.alpha ?? 1.0,
      beta_per_min: args.beta_per_min ?? 0.5,
      congestion_overrides: args.congestion_overrides ?? null
    })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Reroute failed' }));
    throw new Error(apiErrorMessage(err, `Reroute failed (HTTP ${res.status})`));
  }
  return await res.json();
}

