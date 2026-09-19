# Product Requirement Document (PRD): GRIDPOINT — Warehouse Location Optimization Platform

## 1. Executive Summary
**GRIDPOINT** answers: *Where Should the Warehouse Go?* An e-commerce company serves multiple neighborhoods, each with distinct geographic coordinates and daily order volumes. GRIDPOINT is a decision-support platform that ingests neighborhood demand data, visualizes it spatially, computes optimal warehouse location(s), assigns neighborhoods to warehouses, and quantifies delivery effort saved versus the original arrangement. The objective function is **weighted delivery cost minimization**: neighborhoods with higher `daily_orders` contribute proportionally more to total cost.

> Pipeline: `Neighborhood Data` → `Location Visualization` → `Warehouse Optimization` → `Neighborhood Assignment` → `Delivery Cost Comparison`

## 2. Background & Problem Context
- E-commerce demand is spatially dispersed and non-uniform; each neighborhood `i` has position `(lat_i, lon_i)` and weight `w_i = daily_orders_i`.
- Sub-optimal warehouse placement inflates distance, fuel, time, and cost.
- The platform must support `K >= 1` warehouses and optionally respect real-world constraints: capacity, maximum service radius, vehicle/fuel economics, traffic, demand variability, and infrastructure vs. delivery trade-offs.

## 3. Objectives & Success Criteria
| Objective | Measurable Outcome |
| :--- | :--- |
| Minimize weighted delivery distance | `min Σ w_i * d(n_i, w_assigned)` is lower than baseline |
| Operational usability | Non-technical user can upload data → see optimized map in <30s |
| Constraint awareness | Capacity / radius violations are detected and reported; feasible assignments preferred |
| Demonstrability | Working prototype + 2–3 min demo video covering the 5-step pipeline |
| Hackathon fit | Built in 24h window using suggested stack: Python + React + Leaflet/Mapbox |

## 4. Core Requirements Traceability
Directly derived from `problem_statement.md`:

| # | Problem Statement Requirement | PRD Coverage |
| :--- | :--- | :--- |
| R1 | Allow users to upload or enter neighborhood data (location + daily orders) | §5.1 Data Ingestion |
| R2 | Visualize all neighborhood locations on a map | §5.2 Visualization |
| R3 | Allow user to select number of warehouses `K` | §5.3 Warehouse Configuration |
| R4 | Run optimization algorithm to determine suitable warehouse locations | §5.4 Optimization Engine |
| R5 | Assign each neighborhood to its nearest or optimal warehouse | §5.5 Assignment Logic |
| R6 | Calculate total delivery distance and cost | §5.6 Cost Engine |
| R7 | Display optimized warehouse locations and assignments | §5.2 + §5.5 |
| R8 | Compare original vs. optimized arrangement | §5.7 Comparison Module |
| R9 | Consider warehouse capacity and maximum service radius where applicable | §5.8 Constraints |

## 5. Functional Requirements

### 5.1 Data Ingestion & Validation
- **Input modes**: (a) CSV upload, (b) JSON upload, (c) manual tabular entry/edit, (d) synthetic sample generator for demo.
- **Schema** (see `schema.md`): `neighborhood_id` (string, PK), `latitude` (-90 to 90), `longitude` (-180 to 180), `daily_orders` (int ≥0), optional `name`.
- **Validation**: null check, type check, range check, duplicate ID detection; inline error messages; reject/flag invalid rows.
- **Persistence**: In-memory DataFrame/session state; optional export to CSV/JSON.

### 5.2 Interactive Spatial Mapping
- Render all neighborhoods on interactive map (Leaflet via React-Leaflet / Mapbox).
- Bubble sizing proportional to `daily_orders`; tooltip: ID, orders, coordinates.
- Distinct warehouse markers (color/icon per warehouse).
- Polylines/vectors from each neighborhood to its assigned warehouse; cluster coloring by assignment.
- Map auto-fits bounds of dataset; pan/zoom support.

### 5.3 Warehouse Configuration Panel
- `K` selector: integer `1 ≤ K ≤ 10` (slider/dropdown).
- Distance metric toggle: **Haversine** (default, geographic), **Euclidean** (planar approximation), **Manhattan** (grid routing).
- Constraint toggles (off by default, enable for bonus evaluation):
  - Capacity `C_max` per warehouse (orders)
  - Service radius `R_max` per warehouse (km)
  - Vehicle fleet & fuel `cost_per_km` (see §5.8)
  - Infrastructure cost per warehouse (for trade-off analysis)

### 5.4 Optimization Engine
- **Unconstrained (K=1)**: Weighted geometric median via Weiszfeld algorithm.
- **Unconstrained (K>1)**: Weighted K-Means (weights = `daily_orders`); centroids = warehouse locations. Multiple restarts; seeded k-means++.
- **Constrained (Capacitated CFLP)**: Mixed-Integer Linear Programming (PuLP / SciPy / OR-Tools) when `C_max` or `R_max` enabled:
  - Decision variables: `y_k` (open warehouse k), `x_{i,k}` (assignment).
  - Objective: `min Σ_i Σ_k w_i * d_{i,k} * x_{i,k} + Σ_k infra_cost_k * y_k`
  - Constraints: each `i` assigned to exactly one `k`; `Σ_i w_i * x_{i,k} ≤ C_max * y_k`; `d_{i,k} * x_{i,k} ≤ R_max`; `Σ_k y_k = K`.
- **Performance target**: <5s for N=1,000 on typical hardware.

### 5.5 Neighborhood-to-Warehouse Assignment
- Default: nearest warehouse by selected distance metric (unconstrained).
- Constrained: MILP-optimal assignment respecting capacity/radius; fallback to greedy nearest-feasible if infeasible.
- Output: `assignment` mapping `neighborhood_id → warehouse_id` + `distance_km` + `weighted_distance`.

### 5.6 Cost & Distance Calculation
- **Formulas**:
  - `Total Unweighted Distance = Σ d_i`
  - `Total Weighted Distance = Σ w_i * d_i` (km·orders)
  - `Total Delivery Cost = Σ w_i * d_i * cost_per_km + infra_cost` (fuel/vehicle + infra trade-off)
  - `Avg Distance per Order = Total Weighted Distance / Σ w_i`
- Supports per-vehicle `cost_per_km` and `fuel_cost` multipliers.
- Traffic multiplier (bonus): `effective_distance = d_i * (1 + traffic_factor)` or `time = d_i / speed * traffic_delay`.

### 5.7 Comparison: Original vs. Optimized
- **Baseline (Original)** defined as one of: (a) centroid of bounding box, (b) unweighted mean of all neighborhoods, (c) single warehouse at dataset center, or (d) user-provided current warehouse location(s).
- Side-by-side cards: Baseline Cost / Optimized Cost / % Savings; Baseline Distance / Optimized Distance; Capacity Utilization %.
- Delta visualization: before/after map toggle or split view; bar/line chart of distance distribution.
- Exportable summary table.

### 5.8 Constraints & Bonus Feature Modeling
| Bonus Feature (problem_statement) | Implementation Approach |
| :--- | :--- |
| Multiple warehouses | `K` selector + weighted K-Means / MILP |
| Limited warehouse capacity | `C_max` constraint in MILP; utilization gauge per warehouse |
| Maximum delivery radius | `R_max` circle overlay; infeasible assignments flagged |
| Different vehicle types | Fleet table: `vehicle_type, capacity, cost_per_km, fuel_type`; assignment respects vehicle capacity |
| Fuel costs | `fuel_cost_per_km` parameter in cost engine |
| Traffic-dependent delivery times | `traffic_factor` or time-of-day multiplier; display ETA vs distance |
| Changes in customer demand | Demand slider / scenario simulation: scale `w_i` by ±% and re-optimize |
| Infrastructure vs delivery trade-off | Slider for `infra_cost_per_warehouse`; curve showing total cost = infra + delivery vs K |

## 6. Technical Architecture & Tech Stack
| Layer | Suggested Technology | Role |
| :--- | :--- | :--- |
| Language | Python 3.10+ (alt: Java/C++ for solver) | Core logic |
| UI Framework | React | Dashboard & controls |
| Data | Pandas, NumPy | Ingestion, validation, matrices |
| Optimization | scikit-learn (K-Means), SciPy/Weiszfeld, PuLP/OR-Tools (MILP) | Solvers |
| Geospatial | Geopy (Haversine), Leaflet / Mapbox | Distance & mapping |
| Visualization | Plotly / Altair / React charts | Metrics & comparison |

Suggested repo structure: `app.py` (or `frontend/` + `backend/`), `src/data_ingestion.py`, `src/optimization.py`, `src/cost.py`, `src/mapping.py`, `src/validation.py`, `data/samples/`.

## 7. Non-Functional Requirements
- **Performance**: Optimize N=1,000 within 5s; map renders <2s.
- **Usability**: No manual code edits; all config via UI; tooltips for constraints.
- **Reliability**: Graceful handling of infeasible constraints with explanatory message.
- **Reproducibility**: Seeded RNG for synthetic data & K-Means.
- **Submission**: Public GitHub repo with `README.md` disclosing AI tools & libraries; demo video 2–3 min covering full pipeline.
- **Portability**: `requirements.txt` + one-command run (`npm start` or `make run-frontend`).

## 8. Deliverable & Demo Flow
Must demonstrate sequentially:
1. **Neighborhood Data** – upload/edit CSV/JSON or generate synthetic data.
2. **Location Visualization** – neighborhoods appear on map sized by orders.
3. **Warehouse Optimization** – select K & metrics, click Optimize, warehouse pins appear.
4. **Neighborhood Assignment** – colored clusters + connection lines.
5. **Delivery Cost Comparison** – metric cards showing baseline vs optimized savings.

Video script checklist included in `phases.md` Phase 5.

## 9. Out of Scope (v1)
- Real road-network routing (OSRM/Google Directions) — approximated via Haversine/Manhattan.
- Multi-period inventory or dynamic re-routing — static single-period optimization only.
- Authentication / multi-tenant persistence — single-session prototype.

## 10. Risks & Mitigations
| Risk | Mitigation |
| :--- | :--- |
| MILP infeasibility under tight capacity/radius | Pre-check `Σ C_max >= Σ w_i`; warn and suggest K increase |
| Haversine vs Euclidean confusion | Default Haversine; toggle with helper text |
| Large N slowdown | Distance matrix chunking; limit MILP to N≤500 when constraints on |
