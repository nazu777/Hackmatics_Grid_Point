import {
  Neighborhood,
  ValidationResult,
  SyntheticConfig,
  DatasetSummary,
  OptimizationConfig,
  OptimizationResult,
  Warehouse,
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
  CensusDemand
} from '../types';

// In production (single Vercel deployment) API is same-origin at /api
// For split deployments, set VITE_API_URL to backend URL (e.g., https://hackmatics-grid-point-backend.vercel.app)
const API_BASE = (import.meta.env.VITE_API_URL as string) || '/api';

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
      headers: { 'Content-Type': 'application/json' },
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

  const res = await fetch(`${API_BASE}/upload`, {
    method: 'POST',
    body: formData
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({ detail: 'Upload failed' }));
    throw new Error(apiErrorMessage(errorData, `Upload failed (HTTP ${res.status})`));
  }

  return await res.json();
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
      headers: { 'Content-Type': 'application/json' },
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

/** Driving path per origin→destination pair (TomTom → OSRM → straight fallback). */
export async function fetchRouteGeometries(
  pairs: { from: { lat: number; lon: number }; to: { lat: number; lon: number } }[],
  liveTraffic = false
): Promise<RouteGeometry[]> {
  const res = await fetch(`${API_BASE}/routes/geometry`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pairs, live_traffic: liveTraffic })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Route fetch failed' }));
    throw new Error(apiErrorMessage(err, `Route fetch failed (HTTP ${res.status})`));
  }
  const body = (await res.json()) as { routes?: unknown };
  if (!body || !Array.isArray(body.routes)) throw new Error('Route service returned an unexpected shape.');
  return body.routes as RouteGeometry[];
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
  vehicle_type?: string
): Promise<FleetETAResult> {
  try {
    const res = await fetch(`${API_BASE}/scenarios/eta`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assignments, config, vehicle_type })
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

