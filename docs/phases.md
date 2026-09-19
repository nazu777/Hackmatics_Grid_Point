# GridPoint: Development Phases & Sprint Plan
> Aligned to `problem_statement.md` pipeline: `Neighborhood Data` → `Location Visualization` → `Warehouse Optimization` → `Neighborhood Assignment` → `Delivery Cost Comparison`

Hackathon window: 24 hours. Phases are sequential with overlap allowed; each phase has entry criteria, tasks, and exit deliverable with acceptance checks.

---

## Phase 1: Data Ingestion & Environment Setup
**Goal**: Establish codebase, data contracts (`schema.md`), and neighborhood data entry layer — fulfilling *“Allow users to upload or enter neighborhood data including location and daily orders”*.

- **Tasks**:
  1. Initialize repo structure & `requirements.txt` (Python 3.10+, React, Pandas, NumPy, scikit-learn, PuLP/OR-Tools, Leaflet/Mapbox, Geopy).
  2. Define schemas (see `schema.md`) for `Neighborhood`, `Warehouse`, `Assignment`, `OptimizationConfig`.
  3. Implement CSV and JSON parsers (`id`, `latitude`, `longitude`, `daily_orders`, optional `name`) with header auto-detection.
  4. Build manual tabular entry form (add/edit/delete rows, inline validation, duplicate ID guard).
  5. Build synthetic dataset generator (uniform/clustered distributions, seedable, realistic order volumes) for rapid demo/testing.
  6. Implement validation layer: `lat ∈ [-90,90]`, `lon ∈ [-180,180]`, `orders ≥0` integer, non-null checks, client+server feedback.
  7. Add import/export + session persistence.
- **Deliverable**: Functional ingestion UI that loads datasets into validated DataFrame/session state.
- **Acceptance**: Upload sample CSV/JSON (10–1,000 rows) → no crash; invalid rows flagged; synthetic generator yields mappable data.

## Phase 2: Location Visualization & Spatial Mapping
**Goal**: Render geography and user controls — fulfilling *“Visualize all neighborhood locations on a map”* and *“Allow user to select number of warehouses”*.

- **Tasks**:
  1. Integrate interactive map (Leaflet / Mapbox — per tech stack).
  2. Plot neighborhood nodes as circle markers; radius ∝ `daily_orders`; tooltip with ID/orders/coords; color scale by order volume.
  3. Implement warehouse count selector `K` (1–10) + distance metric toggle (Haversine default, Euclidean, Manhattan) with helper text.
  4. Implement constraint control panel (toggles for `C_max`, `R_max`, vehicle/fuel params — wired but optional).
  5. Auto-fit map bounds to dataset bounding box; handle single-point and antipodal edge cases.
  6. Add layer controls: show/hide demand bubbles, base map style switch.
- **Deliverable**: Interactive map displaying all demand nodes with dynamic UI controls for K and metrics.
- **Acceptance**: Changing K/metric updates UI state; map centers correctly; 1,000 nodes render <2s.

## Phase 3: Core Optimization Engine & Assignment Logic
**Goal**: Compute optimal warehouse locations and neighborhood assignments — fulfilling *“Run optimization to determine suitable warehouse locations”* and *“Assign each neighborhood to its nearest or optimal warehouse”* + capacity/radius consideration.

- **Tasks**:
  1. Build distance matrix module: Haversine (Geopy/formula), Euclidean, Manhattan; unit = km; vectorized via NumPy.
  2. Implement **Weiszfeld algorithm** for `K=1` weighted geometric median.
  3. Implement **Weighted K-Means** for `K>1` unconstrained (weights=`daily_orders`, k-means++ init, multiple restarts).
  4. Implement **MILP CFLP solver** (PuLP / OR-Tools) for constrained mode: variables `y_k`, `x_{i,k}`; objective `min Σ w_i·d_{i,k}·x_{i,k}` (+ infra cost if enabled); constraints: single assignment, capacity `Σ w_i·x_{i,k} ≤ C_max`, radius `d_{i,k}·x_{i,k} ≤ R_max`.
  5. Build assignment logic: nearest-warehouse (unconstrained) vs MILP-optimal (constrained); greedy fallback + infeasibility explanation if no feasible solution.
  6. Expose config: `OptimizationConfig` (K, metric, constraints, infra cost, traffic factor) → `OptimizationResult` (warehouse coords, assignments).
  7. Unit test against synthetic grids; benchmark N=1,000 <5s.
- **Deliverable**: Pipeline outputting `warehouses: [{warehouse_id, lat, lon}]` and `assignments: [{neighborhood_id, warehouse_id, distance_km}]`.
- **Acceptance**: For known clusters, warehouses converge near weighted centroids; constrained run respects C_max/R_max or reports violation.

## Phase 4: Cost Calculation & Comparative Evaluation
**Goal**: Quantify delivery effort and compare layouts — fulfilling *“Calculate total delivery distance and cost”*, *“Display optimized warehouse locations and assignments”*, and *“Compare original vs optimized arrangement”*.

- **Tasks**:
  1. Build cost engine:
     - `Total Unweighted Distance = Σ d_i`
     - `Total Weighted Distance = Σ w_i·d_i`
     - `Total Cost = Σ w_i·d_i·cost_per_km + Σ infra_cost_k` (vehicle/fuel/infra aware)
     - `Avg per Order`, `Capacity Utilization %` per warehouse.
  2. Define **baseline (original)**: bounding-box centroid / unweighted mean / single-warehouse mode / user-provided location; compute baseline metrics with same distance metric.
  3. Build comparison UI: side-by-side metric cards (Baseline vs Optimized), % savings, distance saved, cost delta; bar/chart of distance distribution.
  4. Overlay assignments on map: colored clusters, polylines neighborhood→warehouse, warehouse icons, `R_max` radius circles when enabled.
  5. Add export: metrics table to CSV/JSON, map snapshot.
- **Deliverable**: Evaluation dashboard with delta metrics and assignment overlays.
- **Acceptance**: Baseline vs optimized numbers differ correctly; map lines match assignment table; cost formula verified on 3 hand-calculated examples.

## Phase 5: Advanced Constraints, Bonus Features, Polish & Submission
**Goal**: Integrate bonus scoring features, UI polish, and hackathon deliverables.

- **Tasks**:
  1. **Bonus integrations** (each behind toggle, per `problem_statement.md` Bonus Features):
     - Tight `C_max` + utilization gauges & overflow warnings.
     - `R_max` enforcement + violation list.
     - Vehicle fleet table (`vehicle_type`, `capacity`, `cost_per_km`, `fuel_type`) linked to cost engine.
     - Fuel cost `$/km` parameter.
     - Traffic-dependent time: `time = d/speed × (1+traffic_factor)`; display ETA.
     - Demand shift simulator: slider `w_i' = w_i × (1+Δ%)` and re-optimize button.
     - Infrastructure vs delivery trade-off: `infra_cost_per_warehouse` slider + chart of `Total Cost vs K` (elbow analysis).
  2. Polish: responsive layout, dark/light theme, tooltips, loading spinners for optimization, error toasts for infeasibility.
   3. Docs: comprehensive `README.md` (problem recap, architecture diagram, pipeline gif, setup `pnpm install` + `make setup`, AI tools disclosure, library list, schema reference).
  4. Demo video (2–3 min) script: (0:00) Problem intro → (0:20) Upload/edit neighborhoods → (0:45) Map visualization → (1:05) Select K & run optimization → (1:30) Show assignments & warehouses → (1:50) Cost comparison original vs optimized → (2:20) Bonus constraints toggle → (2:45) Close + repo link.
  5. Final QA: test with N=10, 100, 1,000; verify <5s, no console errors, public GitHub push.
- **Deliverable**: Polished prototype, public repo, demo video ready for submission. Covers full pipeline `Neighborhood Data → Location Visualization → Warehouse Optimization → Neighborhood Assignment → Delivery Cost Comparison`.
- **Acceptance**: All 8 core requirements demonstrable end-to-end; at least 3 bonus features toggled live in demo.

---

## Appendix A: Traceability Matrix (Problem Statement → Phase)
| Problem Requirement | Phase | Artefact |
| :--- | :--- | :--- |
| Upload/enter data | 1 | `src/data_ingestion.py`, `schema.md` |
| Visualize on map | 2 | `src/mapping.py` |
| Select K | 2 | Control panel |
| Run optimization | 3 | `src/optimization.py` |
| Assign neighborhoods | 3 | Assignment logic |
| Calculate distance & cost | 4 | `src/cost.py` |
| Display warehouses & assignments | 4 | Map overlays |
| Compare original vs optimized | 4 | Comparison dashboard |
| Capacity & radius | 3,5 | MILP + UI toggles |
| Bonus: vehicles, fuel, traffic, demand, infra | 5 | Extended cost & scenario modules |

## Appendix B: Suggested File Structure
```
app.py
src/
  data_ingestion.py
  validation.py
  optimization.py
  cost.py
  mapping.py
  utils.py
data/
  samples/
docs/
  problem_statement.md
  prd.md
  phases.md
  prompt.md
  schema.md
requirements.txt
README.md
```

## Appendix C: Risk Log
| Risk | Phase Impact | Mitigation |
| :--- | :--- | :--- |
| MILP infeasible (capacity < demand) | 3,4 | Pre-check ΣC_max ≥ Σw_i; suggest increase K/C_max |
| Slow optimization for N>500 with MILP | 3 | Chunking; cap constrained MILP to N≤500 else weighted K-Means |
| Map library mismatch | 2 | Abstract mapping layer; choose one stack early |
