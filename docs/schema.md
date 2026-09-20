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

- **Input**: `Neighborhood` dataset (CSV/JSON/manual, carrying `daily_orders = w_i`) + owned `VehicleType[]` + existing `Warehouse[]` (user's current sites) + `OptimizationConfig` (K, metrics, constraints, traffic/simulation/expansion policy).
- **Output**: `Warehouse` locations, `Assignment` mapping, `Metrics` (weighted distance & cost), `Comparison` (baseline vs optimized), `Overview` aggregate (§2.9), `ExpansionRecommendation` (§2.10).
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
| `daily_orders` | integer | Yes | `≥0`, integer | Daily order volume = weight `w_i` in objective. Lives ONLY on nodes; warehouses derive `assigned_orders = Σ w_i` via assignment (backlog #6, #8). Zero allowed (low-priority node). |
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

Output of optimization; also used for baseline/current locations AND for user-entered existing sites (onboarding trio, backlog #4, #8).

| Field | Type | Required | Constraints | Description |
| :--- | :--- | :--- | :--- | :--- |
| `warehouse_id` | string | Yes | unique, e.g., `W1` | Identifier (`W1`..`WK` for optimized; user ids for existing). |
| `latitude` | float | Yes | `-90..90` | Optimized or user-entered latitude. |
| `longitude` | float | Yes | `-180..180` | Optimized or user-entered longitude. |
| `capacity` | integer | No | `>0` if set | Max orders servable (`C_max` per warehouse). Null = unlimited. |
| `radius_km` | float | No | `>0` if set | Max service radius (`R_max`). Null = unlimited. |
| `infra_cost` | float | No | `≥0` | One-time/fixed infrastructure cost for this warehouse. |
| `assigned_orders` | integer | Derived | `≥0` | Sum of `daily_orders` assigned; computed post-assignment. |
| `utilization_pct` | float | Derived | `0–100` | `assigned_orders / capacity *100` if capacity set. |

### 2.3 VehicleType (owned fleet — onboarding input, backlog #4)

| Field | Type | Required | Constraints | Description |
| :--- | :--- | :--- | :--- | :--- |
| `vehicle_type` | string | Yes | unique | e.g., `bike`, `van`, `truck`. User's owned vehicles (CRUD + synthetic seeder). |
| `capacity` | integer | Yes | `>0` | Orders per trip. |
| `cost_per_km` | float | Yes | `≥0` | Cost per km (fuel+operating, excl. live fuel burn). |
| `fuel_type` | string | No | `petrol/diesel/cng/autogas/electric` (default `petrol`) | For reporting + live price lookup. |
| `avg_speed_kmph` | float | No | `>0` (default `30.0`) | Used for traffic ETA calc. |
| `mileage_kmpl` | float | No | `>0` | Fuel economy; fuel burn = live price / mileage per km. |

### 2.4 OptimizationConfig (User Controls)

| Field | Type | Required | Default | Constraints | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `K` | integer | Yes | `2` | `1 ≤ K ≤ 10` | Number of warehouses. |
| `distance_metric` | enum | Yes | `haversine` | `haversine\|euclidean\|manhattan\|road` | Distance function `d(n_i,w_k)`. `road` uses TomTom Matrix v2 → OSRM → Haversine fallback. |
| `capacity_enabled` | boolean | Yes | `false` | — | Whether to enforce `C_max`. (UI default is ON with a demand-sized `C_max`.) |
| `C_max` | integer | If enabled | — | `>0`, `Σ C_max ≥ Σ w_i` recommended | Per-warehouse capacity. |
| `radius_enabled` | boolean | Yes | `false` | — | Whether to enforce `R_max`. (UI default is ON.) |
| `R_max_km` | float | If enabled | — | `>0` | Per-warehouse service radius. |
| `cost_per_km` | float | No | `1.0` | `≥0` | Unified delivery cost rate ($/km·order). |
| `fuel_cost_per_km` | float | No | `0.0` | `≥0` | Additive fuel surcharge. |
| `infra_cost_per_warehouse` | float | No | `0.0` | `≥0` | Fixed cost per open warehouse for trade-off analysis. |
| `traffic_factor` | float | No | `0.0` | `≥0` (e.g., `0.3`=30% extra time) | Manual multiplier for time estimation (floor under live congestion). |
| `use_live_fuel` | boolean | No | `false` | — | Resolve live RapidAPI India fuel prices for fuel burn. (UI default is ON.) |
| `fuel_state` | string | No | `Karnataka` | — | Indian state for live fuel rates. |
| `fuel_city` | string | No | `None` (first city) | — | City for live fuel rates; auto-resolved from data center when unset. |
| `use_live_traffic` | boolean | No | `false` | — | Use live TomTom corridor speeds for congestion. (UI default is ON.) |
| `traffic_hour` | integer | No | `None` (now) | `0–23` | Hour-of-day for traffic history lookup. |
| `vehicle_fleet` | VehicleType[] | No | `[]` | Owned fleet mix (onboarding input #4); if provided, cost uses fleet-weighted avg. |
| `use_live_traffic_for_routing` | boolean | No | `false` | SHIPPED Phase C Sept 20 2026 (#5): optimize matrices + assignment on current corridor traffic. |
| `traffic_aware_reroute` | boolean | No | `false` | SHIPPED Phase C Sept 20 2026 (#9): re-evaluate assignment as corridors change (`α·cost + β·time`). |
| `simulation_mode` | enum | No | `off` | SHIPPED Phase F Sept 20 2026 (#12, #13): `off\|realtime` — live fuel/traffic/demand loop + congestion spillover. |
| `expansion_policy` | object | No | `None` | SHIPPED Phase E Sept 20 2026 (#11): `{allow_abandon_infra, allow_sell_vehicles, demolition_cost, salvage_value, resale_value, horizon_months, revenue_per_order}`. |
| `random_seed` | integer | No | `42` | — | Seed for K-Means & synthetic data reproducibility. |
| `baseline_mode` | enum | No | `centroid` | `centroid\|mean\|single_center\|custom` | How to compute baseline warehouse(s). |
| `custom_baseline_warehouses` | Warehouse[] | If `custom` | — | Valid lat/lon | User-provided original locations. |

### 2.5 Assignment (Output Mapping)

| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `neighborhood_id` | string | Yes | FK → Neighborhood |
| `warehouse_id` | string | Yes | FK → Warehouse |
| `distance_km` | float | Yes | `d(n_i,w_k)` in km per selected metric (`road` = driving km). |
| `weighted_distance` | float | Yes | `w_i * distance_km` |
| `cost` | float | Yes | `weighted_distance * cost_per_km` (plus fuel if enabled) |
| `fuel_cost` | float | Yes | Per-assignment fuel burn (live price / mileage when live fuel is on). |
| `congestion_pct` | float | No | Corridor congestion applied (delay ratio, live TomTom when enabled). |
| `travel_time_min` | float | No | Road travel time when `distance_metric=road`. |
| `within_radius` | boolean | Yes | `distance_km ≤ R_max` if radius enabled. |
| `is_feasible` | boolean | Yes | `true` if capacity+radius satisfied. |

### 2.6 Metrics (Single Layout)

```json
{
  "total_unweighted_distance_km": 482.3,
  "total_weighted_distance_km_orders": 45210.5,
  "total_cost": 45210.5,
  "total_fuel_cost": 1230.0,
  "fuel_live": false,
  "avg_congestion_pct": 0.0,
  "avg_distance_per_order_km": 8.2,
  "avg_weighted_distance_km": 12.1,
  "warehouses": [
    {"warehouse_id": "W1", "assigned_orders": 320, "utilization_pct": 64.0, "avg_distance_km": 7.5, "neighborhood_count": 6}
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
| `total_fuel_cost` | `Σ assignment.fuel_cost` (live price / mileage when live fuel is on) |
| `fuel_live` | Whether live fuel prices were used |
| `avg_congestion_pct` | Mean corridor congestion applied |
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

Covers all three onboarding datasets — SHIPPED Sept 20 2026 (backlog #4): neighborhoods + deterministic vehicles + warehouses seeders (fixed seeds for demo reproducibility).

| Field | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `N` | integer | `50` | Number of neighborhoods. |
| `lat_center`, `lon_center` | float | `17.385, 78.486` | Center of generation bounding box. |
| `spread_km` | float | `20` | Radius of area to scatter points. |
| `distribution` | enum | `clustered` | `uniform\|clustered\|gaussian` |
| `num_clusters` | integer | `3` | If clustered. |
| `orders_min`, `orders_max` | integer | `10, 200` | Range for `daily_orders`. |
| `seed` | integer | `42` | RNG seed. |

### 2.9 Overview Aggregate (shipped — backlog #14, Overview tab; `POST /api/overview`)

Single rollup the Overview tab renders; every figure deep-links to its source tab. All three #7 fields (`total_fuel_cost`, `avg_congestion_pct`, `feasibility_ratio`) MUST be populated here.

```json
{
  "vehicle_count": 12,
  "vehicle_mix": {"bike": 6, "van": 4, "truck": 2},
  "fuel_price": {"petrol": 105.0, "live": false, "city": null},
  "infra_price": {"per_warehouse": 1500.0, "total": 4500.0},
  "warehouse_count": 3,
  "utilization": [64.0, 41.0, 88.0],
  "order_totals": {"nodes": 25, "daily_orders": 3210},
  "distance_cost": {"metrics": "...", "comparison": "..."},
  "alerts": ["simulation spillover active", "W2 over capacity"]
}
```

### 2.10 ExpansionRecommendation (SHIPPED Sept 20 2026 — backlog #11)

```json
{
  "recommended_plan": {"new_warehouses": ["W4"], "added_vehicles": ["van x2"], "abandoned_infra": [], "sold_vehicles": []},
  "ranked_options": [{"plan": "keep-all + 1 site", "npv": 182500.0, "infra": 1500.0, "fuel": 9200.0, "delivery_saved": 34000.0, "revenue": 160000.0}],
  "rationale": "Keeping W1–W3 and adding W4 beats demolishing W3 once demolition + lost revenue are counted."
}
```

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
    {"neighborhood_id": "N001", "warehouse_id": "W1", "distance_km": 1.2, "weighted_distance": 144.0, "cost": 172.8, "fuel_cost": 4.1, "within_radius": true, "is_feasible": true}
  ],
  "metrics": {"total_weighted_distance_km_orders": 45210.5, "total_cost": 54252.6, "total_fuel_cost": 1230.0},
  "comparison": {"delta": {"pct_cost_saved": 22.6}},
  "is_feasible": true,
  "fuel_note": null,
  "traffic_note": null,
  "routing_note": null
}
```

`fuel_note` / `traffic_note` / `routing_note` report which provider served the result (live vs. fallback) whenever live fuel, live traffic, or `road` mode is used.

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
| `haversine` | Great-circle distance via vectorized NumPy (`EARTH_RADIUS_KM=6371.0088`) | Default geographic distance |
| `euclidean` | `sqrt((lat1-lat2)² + (lon1-lon2)²) * 111km` approx | Fast planar approximation; demo/large N |
| `manhattan` | `(|lat1-lat2|+|lon1-lon2|)*111km` | Grid-like city routing |
| `road` | TomTom Matrix v2 → OSRM table → Haversine fallback (`backend/src/routing.py`, 15-min cache, `MAX_ROUTE_PAIRS=60`) | Real driving km + travel time; assignment and optimization both switch to road distances |

All distances returned in **kilometers**. Straight-line metrics are vectorized via NumPy; `road` is provider-bound and rendered progressively in the UI.

---

## 6. API Contracts

Base: same-origin `/api` in production (`VITE_API_URL` override for split deploys). Auth endpoints issue/verify HS256 JWTs (`Authorization: Bearer <token>`, 24h TTL).

### `POST /api/optimize`

Request: `{ "neighborhoods": Neighborhood[], "config": OptimizationConfig }`
Response: `200 { warehouses, assignments, metrics, comparison, is_feasible, fuel_note, traffic_note, routing_note } | 400 { errors[] } | 422 { infeasible: true, reason, violations[] }`

### `POST /api/validate`

Request: `{ "neighborhoods": Neighborhood[] }`
Response: `{ "valid": boolean, "errors": ValidationError[], "warnings": ValidationError[] }`

### `POST /api/config/validate`

Request: `{ "config": OptimizationConfig, "neighborhoods": Neighborhood[] }`
Response: `{ "valid": boolean, "errors": [], "warnings": [] }` — feasibility pre-check.

### `GET /api/synthetic?N=50&seed=42&distribution=clustered`

Response: `Neighborhood[]` (also accepts `lat_center, lon_center, spread_km, num_clusters, orders_min, orders_max`).

### `GET /api/census/cities` · `GET /api/census/demand?city=&orders_per_1000=`

Real US demand from ACS tract populations (`B01003_001E × orders_per_1000 / 1000 → daily_orders`). Response: `Neighborhood[]`.

### `POST /api/upload` (multipart `file`)

Response: `{ filename, validation, neighborhoods, summary }` — CSV/JSON auto-detection with alias mapping. SHIPPED Sept 20 2026: `?dataset=neighborhoods|vehicles|warehouses` selects the onboarding dataset; plus `POST /api/vehicles/validate`, `POST /api/warehouses/validate`, `GET /api/synthetic/vehicles`, `GET /api/synthetic/warehouses`, `POST /api/export/vehicles`, `POST /api/export/warehouses`.

### `POST /api/export/csv` · `POST /api/export/json` · `POST /api/export/metrics` · `POST /api/export/assignments`

Dataset / metrics-table / assignment-table exports.

### `POST /api/map/summary`

Request: `{ neighborhoods }` → `{ bounds, center, zoom, bubbles }` for the Mapbox layer.

### `POST /api/map/coverage` · `POST /api/map/warehouse-focus`

SHIPPED Phase B Sept 20 2026 (#1, #2): green→red proximity heatmap cells + legend recomputed from active assignment distances; isolated zone payload for a clicked warehouse (`warehouse_focus_summary`: center, `assigned_orders = Σ daily_orders`, utilization, capacity/radius/infra, full assigned-node list).

### `GET /api/fuel/rates?state=` · `GET /api/fuel/price`

Live India fuel prices (RapidAPI, 12h TTL) with static fallback (`{petrol:105, diesel:92, cng:90, autogas:40}`) and `live` flag.

### `GET /api/traffic/flow` · `GET /api/traffic/history`

Live TomTom segment speeds (5-min TTL) + rolling corridor history (`data/traffic_history.json`).

### `POST /api/traffic/corridors` · `POST /api/routes/reroute`

SHIPPED Phase C Sept 20 2026 (#5, #9): corridor congestion aggregated from traced road geometries into rolling history; `traffic_aware_reroute` re-evaluates assignment as corridors change (`α·cost + β·time`), returning changed assignments + saved minutes/₹ with `traffic_note`/`routing_note` provenance.

### `POST /api/routes/geometry`

Traced road polylines for assignment pairs (chunked, progressive in the UI).
Contract fix SHIPPED Phase B Sept 20 2026 (backlog #3): request items accept BOTH `{frm:{lat,lon}, to:{lat,lon}}` and `{from:{lat,lon}, to:{lat,lon}}` spellings (`backend/src/api.py` `_parse_route_pair`); the map UI maps any geometry failure to a friendly "Road path unavailable — showing straight line" notice with a traced/total counter and never renders the raw validator string.

### `POST /api/scenarios/tradeoff` · `/demand-shift` · `/eta` · `/diagnostics`

Multi-K elbow curve; demand scaling (`w_i' = w_i × (1+Δ%)`); fleet + traffic ETA (avg/max minutes, trips, fuel liters); capacity + `R_max` audit.

### `POST /api/expand`

Incrementally add warehouses without moving existing sites (`MAX_WAREHOUSES=10`). SHIPPED Sept 20 2026: accepts `policy` + `owned_vehicles` and returns ranked NPV `recommendation` (keep vs abandon/demolish vs sell).

### `POST /api/simulation/tick` · `POST /api/simulation/live` · `POST /api/overview`

Phase F realtime loop (shipped — #12–#14): one poll tick scales `w_i` from the demand signal, reads corridor congestion per warehouse, and spills nodes off congested warehouses (threshold + hysteresis + cooldown, stateless via `active_spills`); live snapshot returns fuel + traffic + demand feeds; overview returns the `OverviewAggregate` (§2.9). All three degrade to seeded/offline fallbacks with `live=false` notes when providers are unreachable.

### `POST /api/auth/signup` · `POST /api/auth/login` · `GET /api/auth/me`

PBKDF2-HMAC-SHA256 passwords, HS256 JWTs. Store is currently in-memory (`_USERS`); production path is a Neon `users` table (see `backend/src/auth.py` TODO).

---

## 7. Storage (Session / Persistence)

- **React**: per-user namespaced `localStorage` (`gridpoint_neighborhoods_<uid>`, `gridpoint_opt_config_<uid>`, zone colors, recents). Every account starts EMPTY — the Hyderabad sample is opt-in only and never auto-loaded.
- **Auth**: JWT in `localStorage` (`gridpoint_auth_token`, 24h TTL); `AuthContext` resolves the user via `GET /api/auth/me`. Backend store is currently in-memory; Neon Postgres `users` table is the documented production path.
- **Optional DB (Postgres/SQLite)** — demand tables (auth `users` table still TODO in `backend/src/auth.py`):

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
