/**
 * GridPoint TypeScript Data Contracts (schema.md)
 */

export interface Neighborhood {
  neighborhood_id: string;
  name?: string;
  latitude: number;
  longitude: number;
  daily_orders: number;
  zone?: string | null;
}

export interface Warehouse {
  warehouse_id: string;
  latitude: number;
  longitude: number;
  capacity?: number | null;
  radius_km?: number | null;
  infra_cost?: number;
  assigned_orders?: number;
  utilization_pct?: number | null;
}

export interface Assignment {
  neighborhood_id: string;
  warehouse_id: string;
  distance_km: number;
  weighted_distance: number;
  cost: number;
  within_radius: boolean;
  is_feasible: boolean;
  congestion_pct?: number | null;
  travel_time_min?: number | null;
}

export interface OptimizationConfig {
  K: number;
  distance_metric: 'haversine' | 'euclidean' | 'manhattan' | 'road';
  capacity_enabled: boolean;
  C_max?: number | null;
  radius_enabled: boolean;
  R_max_km?: number | null;
  cost_per_km: number;
  fuel_cost_per_km: number;
  infra_cost_per_warehouse: number;
  traffic_factor: number;
  random_seed: number;
  baseline_mode: 'centroid' | 'mean' | 'single_center' | 'custom';
}

export interface WarehouseMetric {
  warehouse_id: string;
  assigned_orders: number;
  utilization_pct?: number | null;
  avg_distance_km: number;
  neighborhood_count: number;
}

export interface Metrics {
  total_unweighted_distance_km: number;
  total_weighted_distance_km_orders: number;
  total_cost: number;
  total_fuel_cost?: number;
  fuel_live?: boolean;
  avg_congestion_pct?: number;
  avg_distance_per_order_km: number;
  avg_weighted_distance_km: number;
  warehouses: WarehouseMetric[];
  infeasible_assignments: number;
  feasibility_ratio: number;
}

export interface ComparisonDelta {
  distance_saved_km: number;
  weighted_distance_saved: number;
  cost_saved: number;
  pct_distance_saved: number;
  pct_cost_saved: number;
}

export interface LayoutEvaluation {
  metrics: Metrics;
  warehouses: Warehouse[];
  assignments: Assignment[];
}

export interface ComparisonResult {
  baseline: LayoutEvaluation;
  optimized: LayoutEvaluation;
  delta: ComparisonDelta;
}

export interface OptimizationResult {
  config: OptimizationConfig;
  warehouses: Warehouse[];
  assignments: Assignment[];
  metrics: Metrics;
  comparison?: ComparisonResult | null;
  is_feasible: boolean;
  infeasibility_reason?: string | null;
  fuel_note?: string | null;
  traffic_note?: string | null;
  routing_note?: string | null;
}

export interface ValidationErrorItem {
  row?: number | null;
  field: string;
  value?: any;
  error: string;
  code: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationErrorItem[];
  warnings: ValidationErrorItem[];
  total_rows: number;
  valid_rows: number;
}

export interface DatasetSummary {
  count: number;
  total_orders: number;
  avg_orders: number;
  min_orders: number;
  max_orders: number;
  center: { lat: number; lon: number };
  bounds: { min_lat: number; max_lat: number; min_lon: number; max_lon: number };
}

export interface SyntheticConfig {
  N: number;
  lat_center: number;
  lon_center: number;
  spread_km: number;
  distribution: 'clustered' | 'uniform' | 'gaussian';
  num_clusters: number;
  orders_min: number;
  orders_max: number;
  seed: number;
}

export type DistanceMetric = 'haversine' | 'euclidean' | 'manhattan' | 'road';

export interface VehicleType {
  vehicle_type: string;
  capacity: number;
  cost_per_km: number;
  fuel_type?: string;
  avg_speed_kmph?: number;
  mileage_kmpl?: number | null;
}

export interface OptimizationConfig {
  K: number;
  distance_metric: DistanceMetric;
  capacity_enabled: boolean;
  C_max?: number | null;
  radius_enabled: boolean;
  R_max_km?: number | null;
  cost_per_km: number;
  fuel_cost_per_km: number;
  infra_cost_per_warehouse: number;
  traffic_factor: number;
  use_live_fuel?: boolean;
  fuel_state?: string;
  fuel_city?: string | null;
  use_live_traffic?: boolean;
  traffic_hour?: number | null;
  vehicle_fleet: VehicleType[];
  random_seed: number;
  baseline_mode: 'centroid' | 'mean' | 'single_center' | 'custom';
}

export type BasemapStyle = 'osm' | 'positron' | 'dark';

/** Bubble color theme for map overlays. */
export type ColorByMode = 'warehouse' | 'zone' | 'demand';

/** Custom zone/category → hex color overrides (persisted to localStorage). */
export type ZoneColorMap = Record<string, string>;

export interface MapLayerOptions {
  showBubbles: boolean;
  showLabels: boolean;
  basemap: BasemapStyle;
  colorBy: ColorByMode;
}

export interface TradeoffPoint {
  K: number;
  delivery_cost: number;
  infra_cost: number;
  total_cost: number;
  avg_distance_km: number;
  pct_cost_saved: number;
  is_feasible: boolean;
}

export interface TradeoffResult {
  points: TradeoffPoint[];
  optimal_K: number;
  min_cost: number;
}

export interface DemandShiftStats {
  pct_delta: number;
  original_total_orders: number;
  new_total_orders: number;
  net_order_change: number;
  actual_pct_change: number;
}

export interface FleetETAResult {
  avg_eta_minutes: number;
  max_eta_minutes: number;
  total_trips: number;
  effective_km: number;
  fuel_consumed_liters: number;
  fuel_price_per_litre?: number | null;
  fuel_type?: string;
  fuel_cost?: number;
  fuel_live?: boolean;
  fuel_note?: string;
  vehicle_used: string;
  avg_speed_kmph: number;
  traffic_congestion_pct: number;
  effective_congestion_pct?: number;
}

export interface FuelCityRate {
  city: string;
  petrol: number | null;
  diesel: number | null;
  cng: number | null;
  autogas: number | null;
}

export interface FuelRates {
  state: string;
  live: boolean;
  cities: FuelCityRate[];
  defaults: Record<string, number>;
  key_configured?: boolean;
}

export interface ConstraintDiagnostics {
  is_compliant: boolean;
  capacity_enabled: boolean;
  radius_enabled: boolean;
  capacity_violations: Array<{
    warehouse_id: string;
    assigned_orders: number;
    capacity: number;
    overflow_orders: number;
    utilization_pct: number;
    severity: 'WARNING' | 'CRITICAL';
  }>;
  radius_violations: Array<{
    neighborhood_id: string;
    warehouse_id: string;
    distance_km: number;
    r_max_km: number;
    overage_km: number;
    severity: 'WARNING' | 'CRITICAL';
  }>;
  total_violations: number;
}


