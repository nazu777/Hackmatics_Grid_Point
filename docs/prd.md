# Product Requirement Document (PRD): GRIDPOINT — Warehouse Location Optimization Platform

## 1. Executive Summary
**GRIDPOINT** answers: *Where Should the Warehouse Go?* An e-commerce company serves multiple neighborhoods, each with distinct geographic coordinates and daily order volumes. GRIDPOINT is a decision-support platform that ingests neighborhood demand data, visualizes it spatially, computes optimal warehouse location(s), assigns neighborhoods to warehouses, and quantifies delivery effort saved versus the original arrangement. The objective function is **weighted delivery cost minimization**: neighborhoods with higher `daily_orders` contribute proportionally more to total cost.

> Pipeline: `Neighborhood Data` → `Location Visualization` → `Warehouse Optimization` → `Neighborhood Assignment` → `Delivery Cost Comparison` → `Overview`
> Status (Sept 20 2026): Phases A, D, E SHIPPED (onboarding trio, per-order cost truth + elbow, expansion policy). Phases B, C, F remain planned. Daily orders live on nodes and flow into warehouses via assignment (#6, #8).

## 2. Background & Problem Context
- E-commerce demand is spatially dispersed and non-uniform; each neighborhood `i` has position `(lat_i, lon_i)` and weight `w_i = daily_orders_i`.
- Sub-optimal warehouse placement inflates distance, fuel, time, and cost.
- The platform must support `K >= 1` warehouses and optionally respect real-world constraints: capacity, maximum service radius, vehicle/fuel economics, traffic, demand variability, and infrastructure vs. delivery trade-offs.

## 3. Objectives & Success Criteria
| Objective | Measurable Outcome |
| :--- | :--- |
| Minimize weighted delivery distance | `min Σ w_i * d(n_i, w_assigned)` is lower than baseline |
| Operational usability | Logged-in user can load sample → see optimized Mapbox map in <30s; fresh accounts start empty |
| Constraint awareness | Capacity / radius violations are detected and reported; feasible assignments preferred |
| Demonstrability | Working prototype + 2–3 min demo video covering the 5-step pipeline |
| Hackathon fit | Built in 24h window using suggested stack: Python + React + Mapbox |

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
- **Input modes**: (a) CSV upload, (b) JSON upload, (c) manual tabular entry/edit, (d) seedable synthetic generator, (e) US Census ACS seeder (real tract populations → `daily_orders`), (f) opt-in Hyderabad sample. Accounts start EMPTY; all datasets are per-user namespaced.
- **Onboarding trio — all required, all seeded (#4)**: (i) order neighborhoods — `Neighborhood` rows carrying `daily_orders = w_i` (#6); (ii) owned vehicles — full fleet table (`vehicle_type, capacity, cost_per_km, fuel_type, avg_speed_kmph, mileage_kmpl`); (iii) existing warehouses — user-owned sites (`warehouse_id, lat/lon, capacity, radius_km, infra_cost`) which double as the "older way" baseline and the keep/abandon set for expansion. New accounts show 0/0/0 with a first-run checklist (orders → vehicles → warehouses → optimize).
- **Synthetic seeders for each (#4)**: neighborhoods (exists) + NEW deterministic vehicles seeder + NEW deterministic warehouses seeder for demo reproducibility.
- **Schema** (see `schema.md`): `neighborhood_id` (string, PK), `latitude` (-90 to 90), `longitude` (-180 to 180), `daily_orders` (int ≥0), optional `name`, optional `zone`.
- **Validation**: null check, type check, range check, duplicate ID detection; inline error messages; reject/flag invalid rows.
- **Persistence**: Per-user `localStorage` (datasets, configs, zone colors, recents); optional export to CSV/JSON; auth via JWT (in-memory store; Neon `users` table = production path).
- **Access**: Landing page + login/signup; `/app/:tab` routes are guarded by `ProtectedRoute`.

### 5.2 Interactive Spatial Mapping
- Render all neighborhoods on an interactive Mapbox GL map (Standard/Light/Dark styles; `VITE_MAPBOX_TOKEN` required).
- Bubble sizing proportional to `daily_orders` (∝ √orders); tooltip: ID, orders, coordinates.
- Distinct warehouse markers (color/icon per warehouse).
- Polylines/vectors from each neighborhood to its assigned warehouse — straight displacement by default, traced road paths in road mode; cluster coloring by assignment.
- Map auto-fits bounds of dataset; pan/zoom support; layer chips (warehouses/routes/demand/radius/traffic); radius preview + Mapbox isochrone service-area heatmaps in road mode.
- **Warehouse click-to-focus (#1)**: clicking a warehouse opens its zone detail (center, zone id, `assigned_orders = Σ daily_orders` of member nodes (#6, #8), utilization, capacity/radius/infra, full assigned-node list with per-node orders + distance); non-selected zones dim/hide; selected zone boundary + members highlight; clear-focus control.
- **Coverage heatmap (#2)**: green (near warehouse) → red (far) continuous gradient over the service area, blended under bubbles/routes, with legend + toggle; recomputed from active assignment distances.
- **Traffic overlay from roads (#5-display)**: corridor congestion derived from traced road geometries, rendered as green→amber→red segments with toggle.
- **Roads-error contract (#3)**: the `displacement → roads` toggle MUST NEVER surface the raw `Pair #0: expected {frm:{lat,lon}, to:{lat,lon}}` validator string — server accepts `{frm|from}` spellings, client falls back to straight lines with a friendly notice + traced/total counter.

### 5.3 Warehouse Configuration Panel
- `K` selector: integer `1 ≤ K ≤ 10` (slider/dropdown).
- Distance metric toggle: **Haversine** (default, geographic), **Euclidean** (planar approximation), **Manhattan** (grid routing), **Road** (real driving distances; triggers full re-optimization).
- Constraint toggles (capacity, radius, live fuel + live traffic are ON by default with a demand-sized `C_max`):
  - Capacity `C_max` per warehouse (orders)
  - Service radius `R_max` per warehouse (km)
  - Vehicle fleet & fuel `cost_per_km` (see §5.8) + live fuel state/city
  - Live traffic + hour-of-day (see §5.8)
  - Infrastructure cost per warehouse (for trade-off analysis)

### 5.4 Optimization Engine
- **Unconstrained (K=1)**: Weighted geometric median via Weiszfeld algorithm.
- **Unconstrained (K>1)**: Weighted K-Means (weights = `daily_orders`); centroids = warehouse locations. Multiple restarts; seeded k-means++.
- **Constrained (Capacitated CFLP)**: Mixed-Integer Linear Programming (PuLP) when `C_max` or `R_max` enabled:
  - Decision variables: `y_k` (open warehouse k), `x_{i,k}` (assignment).
  - Objective: `min Σ_i Σ_k w_i * d_{i,k} * x_{i,k} + Σ_k infra_cost_k * y_k`
  - Constraints: each `i` assigned to exactly one `k`; `Σ_i w_i * x_{i,k} ≤ C_max * y_k`; `d_{i,k} * x_{i,k} ≤ R_max`; `Σ_k y_k = K`.
- **Road mode**: `distance_metric=road` optimizes and assigns on real driving distances (TomTom Matrix v2 → OSRM table → Haversine fallback); toggling it triggers a full re-optimization.
- **Optimize on current traffic (#5-opt, #9)**: explicit `use_live_traffic_for_routing` toggle in the Optimization section; corridor speeds from road geometries feed matrices + assignment; `traffic_aware_reroute` re-evaluates for `α·cost + β·time` as conditions change, reporting changed assignments + saved minutes/₹. Results carry `traffic_note`/`routing_note` provenance.
- **Incremental expansion**: `POST /api/expand` adds warehouses without moving existing sites (by heaviest load / `R_max` miss / farthest cost; `MAX_WAREHOUSES=10`).
- **Performance target**: <5s for N=1,000 on typical hardware (straight-line metrics; road mode is provider-bound and renders progressively).

### 5.5 Neighborhood-to-Warehouse Assignment
- Default: nearest warehouse by selected distance metric (unconstrained) — including road distances when `distance_metric=road`. **Daily orders live on nodes and the node's location decides its warehouse (#6)**; each warehouse aggregates `assigned_orders = Σ w_i` + `utilization_pct` (#8).
- Constrained: MILP-optimal assignment respecting capacity/radius; fallback to greedy nearest-feasible if infeasible.
- Output: `assignment` mapping `neighborhood_id → warehouse_id` + `distance_km` + `weighted_distance` + `cost` + `fuel_cost` (+ `congestion_pct` / `travel_time_min` when live traffic / road mode applies).

### 5.6 Cost & Distance Calculation
- **Formulas**:
  - `Total Unweighted Distance = Σ d_i`
  - `Total Weighted Distance = Σ w_i * d_i` (km·orders)
  - `Total Delivery Cost = Σ w_i * d_i * cost_per_km + infra_cost` (fleet/vehicle + infra trade-off)
  - `Total Fuel Cost = Σ fuel_cost_i` (live price / mileage when live fuel is on)
  - `Avg Distance per Order = Total Weighted Distance / Σ w_i`
- Supports per-vehicle `cost_per_km`, `mileage_kmpl`, and `fuel_cost` multipliers; live India fuel prices auto-resolve from the data center (per-node fuel costs, fuel-reduction graph).
- Traffic multiplier: `effective_distance = d_i * (1 + traffic_factor)` as a floor, plus live TomTom corridor congestion (`congestion_pct`) or `time = d_i / speed * traffic_delay`.

### 5.7 Comparison: Original vs. Optimized
- **Baseline (Original)** defined as one of: (a) centroid of bounding box, (b) unweighted mean of all neighborhoods, (c) single warehouse at dataset center, or (d) user-provided current warehouse location(s) — (d) is the default once onboarding existing warehouses exist (#4, #7).
- **Per-order road + fuel truth (#7)**: every order priced on road `distance_km` × fuel-API price/mileage → `fuel_cost` + `cost`; per-node `avg cost per order` and overall averages, optimized vs older-way side-by-side (per-node table + overall cards).
- **Empty-field fix (#7)**: `Fuel cost portion ($)`, `Avg corridor congestion`, `Feasibility ratio` MUST always render from `total_fuel_cost`, `avg_congestion_pct`, `feasibility_ratio` (explained `—` + tooltip only when genuinely inapplicable).
- **Infra-vs-delivery tradeoff (#10)**: dedicated elbow view — delivery-cost curve vs infra-cost line vs combined total across K, cost-minimizing K annotated with a plain-language "why" caption.
- Side-by-side cards: Baseline Cost / Optimized Cost / % Savings; Baseline Distance / Optimized Distance; Capacity Utilization %.
- Delta visualization: before/after map toggle or split view; bar/line chart of distance distribution.
- Exportable summary table.

### 5.9 Expansion & Scale Advisor (SHIPPED Sept 20 2026 — #11)
- Baseline is the user's REAL current state (existing warehouses + order neighborhoods + owned vehicles from §5.1).
- Policy inputs: `allow_abandon_infra` (keep vs abandon/change/demolish + demolition cost + salvage), `allow_sell_vehicles` (keep vs sell + resale), `horizon_months`, `revenue_per_order`.
- Candidates (new sites + added vehicles) scored on dynamic infra-vs-fuel-vs-delivery economics over the horizon; ONE recommended plan ranked by net benefit (delivery savings + future revenue − capex − abandon/sell frictions) with costed rationale + before/after map + apply-to-main-map.

### 5.10 Realtime Automation (planned — #12, #13)
- `simulation_mode: off|realtime` master switch. When ON: "Traffic Congestion & Fleet ETA" and "Demand Surge & Contraction Simulator" read live fuel + traffic + population feeds on a poll tick — NO manual sliders in the default path (sliders survive only as collapsed offline overrides).
- Congestion spillover: sustained congestion near a warehouse (threshold + hysteresis + cooldown) reassigns nodes to the next-best warehouse until the surge clears; event log records spill start/end, moved nodes, recovered savings.

### 5.11 Overview Tab (planned — #14)
- Single screen aggregating: vehicle count + mix, current fuel price(s) + `fuel_live` provenance, infra price(s), warehouse count + utilization, order totals, distance/cost/fuel/congestion/feasibility summaries, pending simulation/expansion alerts — every figure deep-links to its source tab.

### 5.8 Constraints & Bonus Feature Modeling
| Bonus Feature (problem_statement) | Implementation Approach |
| :--- | :--- |
| Multiple warehouses | `K` selector + weighted K-Means / MILP |
| Limited warehouse capacity | `C_max` constraint in MILP; utilization gauge per warehouse |
| Maximum delivery radius | `R_max` circle overlay; infeasible assignments flagged |
| Different vehicle types | Fleet table: `vehicle_type, capacity, cost_per_km, fuel_type, avg_speed_kmph, mileage_kmpl`; assignment respects vehicle capacity |
| Fuel costs | Live India fuel prices (`fuel.py`, `GET /api/fuel/rates`) + `fuel_cost_per_km` parameter; per-node fuel costs + fuel-reduction graph in comparison |
| Traffic-dependent delivery times | Live TomTom flow + corridor history (`traffic.py`) with `traffic_factor` floor; `congestion_pct` + fleet ETA display |
| Changes in customer demand | Demand slider / scenario simulation: scale `w_i` by ±% and re-optimize (`POST /api/scenarios/demand-shift`) |
| Infrastructure vs delivery trade-off | Slider for `infra_cost_per_warehouse`; curve showing total cost = infra + delivery vs K (`POST /api/scenarios/tradeoff`) |

Shipped extensions beyond the 8 bonuses: road-network optimization (`distance_metric=road`, `POST /api/routes/geometry`), incremental warehouse expansion (`POST /api/expand`), Census demand seeding (`GET /api/census/*`), JWT auth + per-account workspaces (`/api/auth/*`).

## 6. Technical Architecture & Tech Stack
| Layer | Technology | Role |
| :--- | :--- | :--- |
| Language | Python 3.10+ | Core logic (FastAPI + optimization core) |
| UI Framework | React 18 + Vite + TypeScript + React Router 7 | Dashboard, controls, guarded `/app/:tab` routes |
| Data | Pandas, NumPy | Ingestion, validation, matrices |
| Optimization | scikit-learn (K-Means), Weiszfeld, PuLP (MILP) | Solvers (+ road-aware assignment, incremental expansion) |
| Geospatial | Geopy (Haversine), Mapbox GL JS | Distance & mapping (TomTom/OSRM for road mode) |
| Visualization | Mapbox GL + app charts (histogram, elbow curve, fuel graph) | Metrics & comparison |
| Live data | TomTom Traffic/Matrix, RapidAPI India fuel, US Census ACS | Congestion, road distances, fuel prices, real demand |
| Auth | JWT (PBKDF2 + HS256, 24h TTL; in-memory store, Neon `users` table = production path) | Login/signup, per-account workspaces |

Repo structure (actual): `backend/src/*.py` (17 modules) + `backend/tests/` (115 tests), `frontend/src/` (App router, services/api, context/AuthContext, data/sample, 30+ components), `api/index.py` + `api/src/` mirror (Vercel), `data/samples/` (7 files + census cache), `docs/`, `Makefile` (`setup/test/run-backend/run-frontend/build-frontend/sync-api`), root + frontend `package.json`, `vercel.json`, `pnpm-workspace.yaml`.

## 7. Non-Functional Requirements
- **Performance**: Optimize N=1,000 within 5s (straight-line metrics); map renders <2s; road mode is provider-bound and renders progressively.
- **Usability**: No manual code edits; all config via UI; tooltips for constraints; accounts start empty with an opt-in sample.
- **Reliability**: Graceful handling of infeasible constraints with explanatory message; live providers degrade to static fallbacks with `live=false` + notes.
- **Reproducibility**: Seeded RNG for synthetic data & K-Means.
- **Submission**: Public GitHub repo with `README.md` disclosing AI tools & libraries; demo video 2–3 min covering full pipeline.
- **Portability**: `backend/requirements.txt` + `api/requirements.txt` + one-command run (`make setup`, `make run-backend`, `make run-frontend`); `VITE_MAPBOX_TOKEN` required for maps.

## 8. Deliverable & Demo Flow
Must demonstrate sequentially:
1. **Neighborhood Data** – upload/edit CSV/JSON or generate synthetic data.
2. **Location Visualization** – neighborhoods appear on map sized by orders.
3. **Warehouse Optimization** – select K & metrics, click Optimize, warehouse pins appear.
4. **Neighborhood Assignment** – colored clusters + connection lines.
5. **Delivery Cost Comparison** – metric cards showing baseline vs optimized savings.

Video script checklist included in `phases.md` Phase 5.

## 9. Out of Scope (v1) — status update
- ~~Real road-network routing (OSRM/Google Directions) — approximated via Haversine/Manhattan.~~ **SHIPPED**: `distance_metric=road` (TomTom Matrix v2 → OSRM table → Haversine fallback) with traced polylines, re-optimization on toggle, and isochrone radius heatmaps.
- Multi-period inventory or dynamic re-routing — static single-period optimization only (demand-shift re-optimization is supported, not multi-period inventory).
- ~~Authentication / multi-tenant persistence — single-session prototype.~~ **SHIPPED (v1)**: JWT login/signup + per-account namespaced workspaces (in-memory store; Neon `users` table is the production path).

## 10. Risks & Mitigations
| Risk | Mitigation |
| :--- | :--- |
| MILP infeasibility under tight capacity/radius | Pre-check `Σ C_max >= Σ w_i`; warn and suggest K increase |
| Haversine vs Euclidean confusion | Default Haversine; toggle with helper text |
| Large N slowdown | Distance matrix chunking; limit MILP to N≤500 when constraints on |
