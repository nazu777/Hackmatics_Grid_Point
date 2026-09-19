# GridPoint — Data Schema & Contracts

> Single source of truth for data shapes across ingestion, optimization, assignment, mapping, and cost modules. All field names are canonical; UI, parsers, and solvers MUST use these exact keys.

---

## 1. Overview & Pipeline Binding

```ini
Neighborhood[]  ─┐
                 ├─► OptimizationConfig ─► OptimizationEngine ─► Warehouse[] + Assignment[] ─► Metrics / Comparison
VehicleFleet[] ──┘                                                              ▲
BaselineConfig ─────────────────────────────────────────────────────────────────┘
```

- **Input**: `Neighborhood` dataset (CSV/JSON/manual) + `OptimizationConfig` (K, metrics, constraints).
- **Output**: `Warehouse` locations, `Assignment` mapping, `Metrics` (weighted distance & cost), `Comparison` (baseline vs optimized).
- **Units**: Coordinates in WGS84 decimal degrees, distances in kilometers (km), cost in INR, orders as integer counts.

---

## 2. Core Entities

### 2.1 Neighborhood (Demand Node)

Represents a neighborhood served by the network. Primary input entity.

| Field | Type | Required | Constraints | Description |
| :--- | :--- | :--- | :--- | :--- |
| `neighborhood_id` | string | Yes | unique, non-empty, PK | Stable identifier (e.g., `N001`, `downtown`). Duplicates rejected. |
| `name` | string | No | max 100 chars | Human-readable label; defaults to `neighborhood_id` if absent. |
| `latitude` | float | Yes | `-90.0 ≤ lat ≤ 90.0` | WGS84 latitude. |
| `longitude` | float | Yes | `-180.0 ≤ lon ≤ 180.0` | WGS84 longitude. |
| `daily_orders` | integer | Yes | `≥0`, integer | Daily order volume = weight `w_i` in objective. Zero allowed (low-priority node). |
| `zone` | string | No | enum free-form | Optional grouping for clustered visualization. |

**JSON example:**

```json
{
  "neighborhood_id": "N001",
  "name": "Downtown",
  "latitude": 17.385044,
  "longitude": 78.486671,
  "daily_orders": 120
}
```

**CSV header (canonical):**

```sql
neighborhood_id,name,latitude,longitude,daily_orders
```

Aliases accepted on ingest (mapped to canonical): `id`→`neighborhood_id`, `lat`→`latitude`, `lng`/`lon`→`longitude`, `orders`/`demand`→`daily_orders`.

### 2.2 Warehouse (Facility)

Output of optimization; also used for baseline/current locations.

| Field | Type | Required | Constraints | Description |
| :--- | :--- | :--- | :--- | :--- |
| `warehouse_id` | string | Yes | unique, e.g., `W1` | Identifier (`W1`..`WK`). |
| `latitude` | float | Yes | `-90..90` | Optimized latitude. |
| `longitude` | float | Yes | `-180..180` | Optimized longitude. |
| `capacity` | integer | No | `>0` if set | Max orders servable (`C_max` per warehouse). Null = unlimited. |
| `radius_km` | float | No | `>0` if set | Max service radius (`R_max`). Null = unlimited. |
| `infra_cost` | float | No | `≥0` | One-time/fixed infrastructure cost for this warehouse. |
| `assigned_orders` | integer | Derived | `≥0` | Sum of `daily_orders` assigned; computed post-assignment. |
| `utilization_pct` | float | Derived | `0–100` | `assigned_orders / capacity *100` if capacity set. |

### 2.3 VehicleType (Bonus)

| Field | Type | Required | Constraints | Description |
| :--- | :--- | :--- | :--- | :--- |
| `vehicle_type` | string | Yes | unique | e.g., `bike`, `van`, `truck`. |
| `capacity` | integer | Yes | `>0` | Orders per trip. |
| `cost_per_km` | float | Yes | `≥0` | Cost per km (fuel+operating). |
| `fuel_type` | string | No | `petrol/diesel/electric` | For reporting. |
| `avg_speed_kmph` | float | No | `>0` | Used for traffic ETA calc. |

### 2.4 OptimizationConfig (User Controls)

| Field | Type | Required | Default | Constraints | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `K` | integer | Yes | `2` | `1 ≤ K ≤ 10` | Number of warehouses. |
| `distance_metric` | enum | Yes | `haversine` | `haversine|euclidean|manhattan` | Distance function `d(n_i,w_k)`. |
| `capacity_enabled` | boolean | Yes | `false` | — | Whether to enforce `C_max`. |
| `C_max` | integer | If enabled | — | `>0`, `Σ C_max ≥ Σ w_i` recommended | Per-warehouse capacity. |
| `radius_enabled` | boolean | Yes | `false` | — | Whether to enforce `R_max`. |
| `R_max_km` | float | If enabled | — | `>0` | Per-warehouse service radius. |
| `cost_per_km` | float | No | `1.0` | `≥0` | Unified delivery cost rate ($/km·order). |
| `fuel_cost_per_km` | float | No | `0.0` | `≥0` | Additive fuel surcharge. |
| `infra_cost_per_warehouse` | float | No | `0.0` | `≥0` | Fixed cost per open warehouse for trade-off analysis. |
| `traffic_factor` | float | No | `0.0` | `≥0` (e.g., `0.3`=30% extra time) | Multiplier for time estimation. |
| `vehicle_fleet` | VehicleType[] | No | `[]` | — | Fleet mix; if provided, cost uses fleet-weighted avg. |
| `random_seed` | integer | No | `42` | — | Seed for K-Means & synthetic data reproducibility. |
| `baseline_mode` | enum | No | `centroid` | `centroid|mean|single_center|custom` | How to compute baseline warehouse(s). |
| `custom_baseline_warehouses` | Warehouse[] | If `custom` | — | Valid lat/lon | User-provided original locations. |

### 2.5 Assignment (Output Mapping)

| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `neighborhood_id` | string | Yes | FK → Neighborhood |
| `warehouse_id` | string | Yes | FK → Warehouse |
| `distance_km` | float | Yes | `d(n_i,w_k)` in km per selected metric. |
| `weighted_distance` | float | Yes | `w_i * distance_km` |
| `cost` | float | Yes | `weighted_distance * cost_per_km` (plus fuel if enabled) |
| `within_radius` | boolean | Yes | `distance_km ≤ R_max` if radius enabled. |
| `is_feasible` | boolean | Yes | `true` if capacity+radius satisfied. |

### 2.6 Metrics (Single Layout)

```json
{
  "total_unweighted_distance_km": 482.3,
  "total_weighted_distance_km_orders": 45210.5,
  "total_cost": 45210.5,
  "avg_distance_per_order_km": 8.2,
  "avg_weighted_distance_km": 12.1,
  "warehouses": [
    {"warehouse_id": "W1", "assigned_orders": 320, "utilization_pct": 64.0, "avg_distance_km": 7.5}
  ],
  "infeasible_assignments": 0,
  "feasibility_ratio": 1.0
}
```

| Metric | Formula |
| :--- | :--- |
| `total_unweighted_distance_km` | `Σ d_i` |
| `total_weighted_distance_km_orders` | `Σ w_i * d_i` |
| `total_cost` | `Σ w_i*d_i*cost_per_km + Σ infra_cost_k` (+ fuel if set) |
| `avg_distance_per_order_km` | `total_weighted_distance / Σ w_i` |
| `feasibility_ratio` | `feasible_assignments / N` |

### 2.7 Comparison (Original vs Optimized)

```json
{
  "baseline": { "metrics": {...}, "warehouses": [...] },
  "optimized": { "metrics": {...}, "warehouses": [...] },
  "delta": {
    "distance_saved_km": 120.5,
    "weighted_distance_saved": 10200.0,
    "cost_saved": 10200.0,
    "pct_distance_saved": 18.5,
    "pct_cost_saved": 22.6
  }
}
```

### 2.8 Synthetic Generation Config

| Field | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `N` | integer | `50` | Number of neighborhoods. |
| `lat_center`, `lon_center` | float | `17.385, 78.486` | Center of generation bounding box. |
| `spread_km` | float | `20` | Radius of area to scatter points. |
| `distribution` | enum | `clustered` | `uniform|clustered|gaussian` |
| `num_clusters` | integer | `3` | If clustered. |
| `orders_min`, `orders_max` | integer | `10, 200` | Range for `daily_orders`. |
| `seed` | integer | `42` | RNG seed. |

---

## 3. File Formats & Examples

### 3.1 CSV Input (canonical header)

```csv
neighborhood_id,name,latitude,longitude,daily_orders
N001,Downtown,17.385044,78.486671,120
N002,Uptown,17.400000,78.500000,80
N003,Suburb West,17.370000,78.450000,45
```

### 3.2 JSON Input

```json
[
  {"neighborhood_id": "N001", "latitude": 17.385044, "longitude": 78.486671, "daily_orders": 120},
  {"neighborhood_id": "N002", "latitude": 17.400000, "longitude": 78.500000, "daily_orders": 80}
]
```

Alternative wrapped form accepted: `{"neighborhoods": [...]}`.

### 3.3 Optimization Result JSON (output)

```json
{
  "config": {"K": 2, "distance_metric": "haversine", "cost_per_km": 1.2},
  "warehouses": [
    {"warehouse_id": "W1", "latitude": 17.388, "longitude": 78.482, "assigned_orders": 200, "utilization_pct": 80.0},
    {"warehouse_id": "W2", "latitude": 17.405, "longitude": 78.51, "assigned_orders": 45, "utilization_pct": 18.0}
  ],
  "assignments": [
    {"neighborhood_id": "N001", "warehouse_id": "W1", "distance_km": 1.2, "weighted_distance": 144.0, "cost": 172.8, "within_radius": true, "is_feasible": true}
  ],
  "metrics": {"total_weighted_distance_km_orders": 45210.5, "total_cost": 54252.6},
  "comparison": {"delta": {"pct_cost_saved": 22.6}}
}
```

---

## 4. Validation Rules (Enforced in `src/validation.py`)

| Check | Level | Action |
| :--- | :--- | :--- |
| `latitude` out of [-90,90] | Error | Reject row, show inline error |
| `longitude` out of [-180,180] | Error | Reject row |
| `daily_orders` non-integer or <0 | Error | Reject row |
| `neighborhood_id` null/empty/duplicate | Error | Reject row / flag duplicate |
| `K` outside 1–10 | Error | Clamp or block optimization |
| `C_max` < max single `w_i` | Warning | Suggest increase; MILP will be infeasible |
| `Σ C_max < Σ w_i` | Error | Block constrained optimization, show infeasibility message |
| `R_max` < min feasible covering radius | Warning | Show violation count post-assignment |
| CSV header missing required columns | Error | Show mapping prompt |
| Empty dataset (N=0) | Error | Block optimization |
| N > 1000 with MILP enabled | Warning | Recommend unconstrained mode for performance |

Error response shape:

```json
{"row": 3, "field": "latitude", "value": 120.5, "error": "latitude must be in [-90, 90]", "code": "OUT_OF_RANGE"}
```

---

## 5. Distance Metrics

| Metric | Formula / Library | When to Use |
| :--- | :--- | :--- |
| `euclidean` | `sqrt((lat1-lat2)² + (lon1-lon2)²) * 111km` approx | Fast planar approximation; demo/large N |
| `manhattan` | `(|lat1-lat2|+|lon1-lon2|)*111km` | Grid-like city routing |

All distances returned in **kilometers**. Vectorized computation via NumPy/Geopy.

---

## 6. API Contracts (if backend separated)

### `POST /api/optimize`

Request: `{ "neighborhoods": Neighborhood[], "config": OptimizationConfig }`
Response: `200 { warehouses, assignments, metrics, comparison } | 400 { errors[] } | 422 { infeasible: true, reason, violations[] }`

### `POST /api/validate`

Request: `{ "neighborhoods": Neighborhood[] }`
Response: `{ "valid": boolean, "errors": ValidationError[], "warnings": ValidationError[] }`

### `GET /api/synthetic?N=50&seed=42&distribution=clustered`

Response: `Neighborhood[]`

---

## 7. Storage (Session / Optional Persistence)

- __Streamlit__: `st.session_state.neighborhoods_df` (Pandas DataFrame with canonical columns), `st.session_state.config`, `st.session_state.result`.
- **React**: Local state / Context; optional `localStorage` for draft dataset.
- **Optional DB (Postgres/SQLite)**:

```sql
CREATE TABLE neighborhoods (
  neighborhood_id TEXT PRIMARY KEY,
  name TEXT,
  latitude DOUBLE PRECISION CHECK (latitude BETWEEN -90 AND 90),
  longitude DOUBLE PRECISION CHECK (longitude BETWEEN -180 AND 180),
  daily_orders INTEGER CHECK (daily_orders >= 0)
);
CREATE TABLE warehouses (
  warehouse_id TEXT PRIMARY KEY,
  latitude DOUBLE PRECISION, longitude DOUBLE PRECISION,
  capacity INTEGER, radius_km DOUBLE PRECISION, infra_cost DOUBLE PRECISION
);
CREATE TABLE assignments (
  neighborhood_id TEXT REFERENCES neighborhoods,
  warehouse_id TEXT REFERENCES warehouses,
  distance_km DOUBLE PRECISION, weighted_distance DOUBLE PRECISION,
  PRIMARY KEY (neighborhood_id)
);
```

---

## 8. Versioning & Extensibility

- Schema version: `1.0.0` (stored as `schema_version` in exported JSON).
- Additive changes only within minor version (new optional fields).
- Bonus fields (`VehicleType`, `traffic_factor`, `infra_cost`) are optional and backward-compatible; unconstrained core works without them.
