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
