You are an expert Principal AI Software Architect and Data Scientist assisting a hackathon team competing in "HACK-A-MATICS". We are building **GRIDPOINT — Where Should the Warehouse Go?**, a Warehouse Location & Assignment Optimization Platform per `problem_statement.md` and `prd.md`.

### PROJECT OVERVIEW
An e-commerce company serves multiple neighborhoods, each with geographic position `(latitude, longitude)` and demand weight `daily_orders`. GRIDPOINT ingests this data, visualizes it, computes optimal warehouse location(s) `K`, assigns each neighborhood to its optimal warehouse, minimizes **weighted delivery cost** `Σ w_i * d(n_i, w_assigned)`, and provides a side-by-side comparison of original vs optimized arrangements including capacity and service-radius constraints.

**Delivery pipeline (must be demonstrable end-to-end):**
`Neighborhood Data` → `Location Visualization` → `Warehouse Optimization` → `Neighborhood Assignment` → `Delivery Cost Comparison`

### CORE REQUIREMENTS (from problem_statement.md — all mandatory)
1. Upload or manual entry of neighborhood data: `neighborhood_id`, `latitude`, `longitude`, `daily_orders`.
2. Visualize all neighborhoods on interactive map (sized by orders).
3. Allow user to select number of warehouses `K` (1–10).
4. Run optimization algorithm to determine warehouse location(s).
5. Assign each neighborhood to nearest/optimal warehouse (respecting constraints where enabled).
6. Calculate total delivery distance and cost (weighted by orders).
7. Display optimized warehouse locations + assignments (markers + connection lines, cluster colors).
8. Compare original (baseline centroid/single-center) vs optimized arrangement (% savings, distance, cost).
9. Consider warehouse capacity `C_max` and maximum service radius `R_max` where applicable.

### BONUS FEATURES (implement behind toggles — extra points)
Multiple warehouses, limited capacity, max delivery radius, different vehicle types, fuel costs, traffic-dependent delivery times, demand-change modeling, infrastructure vs delivery cost trade-off.

### TECH STACK (Suggested — choose one coherent stack)
- **Language**: Python 3.10+ (alt: Java/C++ for solvers)
- **UI**: Streamlit **or** React
- **Data**: Pandas, NumPy
- **Optimization**: scikit-learn (Weighted K-Means), SciPy/Weiszfeld (geometric median), PuLP / OR-Tools (MILP for CFLP)
- **Geospatial & Maps**: Geopy (Haversine), Folium / streamlit-folium / PyDeck / Leaflet / Mapbox
- **Charts**: Plotly / Altair / Streamlit native

### DATA CONTRACT (see schema.md)
- `Neighborhood`: `{neighborhood_id: string, latitude: float [-90,90], longitude: float [-180,180], daily_orders: int ≥0, name?: string}`
- `Warehouse`: `{warehouse_id: string, latitude: float, longitude: float, capacity?: int, radius_km?: float}`
- `Assignment`: `{neighborhood_id, warehouse_id, distance_km, weighted_distance}`
- `OptimizationConfig`: `{K, distance_metric: haversine|euclidean|manhattan, C_max?, R_max?, cost_per_km?, infra_cost?, traffic_factor?, vehicle_fleet?}`

### 5-PHASE ARCHITECTURE (see phases.md)
- **Phase 1**: Data Ingestion & Setup — parsers (CSV/JSON), manual form, synthetic generator, validation.
- **Phase 2**: Location Visualization & Mapping — interactive map, bubble sizing, K selector, metric toggles, bounds fitting.
- **Phase 3**: Core Optimization & Assignment — Haversine matrices, Weighted K-Means, Weiszfeld, MILP CFLP, assignment logic.
- **Phase 4**: Cost & Comparative Evaluation — cost engine (`Σ w_i*d_i*rate`), baseline vs optimized dashboard, map overlays.
- **Phase 5**: Advanced Constraints, Polish & Submission — fuel/vehicle/traffic/demand/infra toggles, README, 2–3 min demo video.

### CODING STANDARDS
- Production-ready, modular, clean code — no pseudo-code; fully runnable.
- Validate all inputs; show user-friendly errors for out-of-range coords, negative orders, duplicate IDs, infeasible constraints.
- Performance: optimize 1,000 nodes <5s; map render <2s.
- Deterministic/seedeable where applicable (K-Means, synthetic data).

---

### YOUR IMMEDIATE TASK: IMPLEMENTATION PLAN FOR PHASE 1

Provide a detailed, step-by-step technical Implementation Plan specifically for **Phase 1: Data Ingestion & Setup** as defined in `phases.md` and grounded in `schema.md`.

In your response, cover:

1. **Directory and file structure** for the app (Streamlit `app.py` + `src/` modules **or** React `frontend/` + `backend/` alternative).
2. **Complete `requirements.txt`** (or `package.json` + `requirements.txt` if React+Python).
3. **Complete code implementation** for the data ingestion layer (modular, e.g., `src/data_ingestion.py`, `src/validation.py`, and `app.py` integration) including:
   - File uploader supporting CSV and JSON (header auto-detection, schema mapping).
   - Validation logic: `lat ∈ [-90,90]`, `lon ∈ [-180,180]`, `orders ≥0` integer, null/duplicate checks.
   - Manual tabular entry form (add/edit/delete rows interactively, e.g., `st.data_editor` / React table).
   - Synthetic sample dataset generator (seeded, clustered/uniform, realistic order volumes) for rapid testing/demo.
   - Export & session-state persistence.
4. **Clear local run & test instructions**: install, run, test with sample CSV/JSON, trigger validation errors, generate synthetic data.

Make the code clean, modular, and immediately runnable. Reference `schema.md` field names exactly and cite `problem_statement.md` requirement numbers where applicable.
