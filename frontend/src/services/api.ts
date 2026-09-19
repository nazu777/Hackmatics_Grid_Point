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
  ConstraintDiagnostics
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
    throw new Error(errorData.detail || 'Upload failed');
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

// Client-side synthetic generator fallback
function localGenerateSynthetic(config: SyntheticConfig): Neighborhood[] {
  const nodes: Neighborhood[] = [];
  const latDelta = config.spread_km / 111.0;
  const lonDelta = config.spread_km / (111.0 * Math.cos(config.lat_center * Math.PI / 180));

  for (let i = 0; i < config.N; i++) {
    const angle = (i / config.N) * 2 * Math.PI;
    const radius = Math.random();
    const lat = config.lat_center + Math.sin(angle) * radius * latDelta;
    const lon = config.lon_center + Math.cos(angle) * radius * lonDelta;
    const orders = Math.floor(config.orders_min + Math.random() * (config.orders_max - config.orders_min + 1));
    nodes.push({
      neighborhood_id: `N${String(i + 1).padStart(3, '0')}`,
      name: `Cluster Hub #${i + 1}`,
      latitude: parseFloat(lat.toFixed(6)),
      longitude: parseFloat(lon.toFixed(6)),
      daily_orders: orders,
      zone: `Zone-${(i % config.num_clusters) + 1}`
    });
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
  });

  const totalDemand = neighborhoods.reduce((sum, n) => sum + (Number(n.daily_orders) || 0), 0);

  const metrics: Metrics = {
    total_unweighted_distance_km: parseFloat(totalUnweightedDist.toFixed(2)),
    total_weighted_distance_km_orders: parseFloat(totalWeightedDist.toFixed(2)),
    total_cost: parseFloat((totalCost + K * config.infra_cost_per_warehouse).toFixed(2)),
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

  const distSaved = Math.max(0, baseWeightedDist - totalWeightedDist);
  const costSaved = Math.max(0, baseCost - metrics.total_cost);

  const comparison: ComparisonResult = {
    baseline: {
      metrics: {
        total_unweighted_distance_km: parseFloat(baseUnweightedDist.toFixed(2)),
        total_weighted_distance_km_orders: parseFloat(baseWeightedDist.toFixed(2)),
        total_cost: parseFloat(baseCost.toFixed(2)),
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
    infeasibility_reason: infeasibleCount > 0 ? `${infeasibleCount} assignments exceed radius limit` : null
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

