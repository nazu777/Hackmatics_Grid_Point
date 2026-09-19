import { Neighborhood, ValidationResult, SyntheticConfig, DatasetSummary } from '../types';

const API_BASE = '/api';

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

  const res = await fetch(`${API_BASE}/synthetic?${params.toString()}`);
  if (!res.ok) throw new Error(`Failed to generate synthetic data: ${res.statusText}`);
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
  } catch (e) {
    // Fallback
  }
  // Client-side CSV generation fallback
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
