# GRIDPOINT — Where Should the Warehouse Go?

> **Warehouse Location & Assignment Optimization Platform**
> Built for the **HACK-A-MATICS** Hackathon.
> Aligned to [problem_statement.md](docs/problem_statement.md), [prd.md](docs/prd.md), [schema.md](docs/schema.md), and [phases.md](docs/phases.md).

**Live Production Deployment**: [https://hackmatics-grid-point.vercel.app](https://hackmatics-grid-point.vercel.app)
**Automated Tests**: 113 collected, ~5s (`make test`; 111 pass on Apple Silicon, 2 MILP tests need Linux/x86_64 CBC — see Known Issues)
**Persistence**: per-account `localStorage` + in-memory session (demo-only JWT in `backend/src/auth.py`; no required DB)

---

## Overview & Problem Statement

An e-commerce company serves multiple neighborhoods, each with `(latitude, longitude)` and daily demand `daily_orders` ($w_i$). Bad placement wastes delivery miles and fuel.

**GRIDPOINT** minimizes weighted delivery cost:

$$\min \sum_{i=1}^{N} w_i \cdot d(n_i, w_{\text{assigned}}) \cdot \text{rate}_{\text{eff}} + \sum_{k=1}^{K} \text{infra\_cost}_k$$

where `d_eff = d * (1 + traffic_factor + corridor_congestion)` and `rate_eff = fleet-weighted cost_per_km + fuel burn (live ₹/L ÷ mileage) + fuel_cost_per_km`. See `backend/src/cost.py`.

### 5-Step Pipeline (Demonstrable End-to-End)

```ini
Neighborhood Data (Phase 1) ──► Location Visualization (Phase 2) ──► Warehouse Optimization (Phase 3)
                                                                               │
Delivery Cost Comparison (Phase 4) ◄── Neighborhood Assignment (Phase 3) ◄─────┘
               │
What-If Scenarios & Bonus Fleet (Phase 5)
```

---

## System Architecture

Monorepo: **React 18 + Vite + TypeScript + Tailwind** frontend, **FastAPI + Pydantic v2** backend, shared optimization core. `api/index.py` is a thin Vercel adapter (imports `backend/src/api.py`, synced copy in `api/src/` via `make sync-api`).

```
Hackmatics_Grid_Point/
├── backend/
│   ├── src/
<│   │   ├── schema.py              # Pydantic v2 data contracts (schema.md §2)
│   │   ├── validation.py          # Strict schema validation engine (§4)
│   │   ├── data_ingestion.py      # CSV/JSON parsers, alias detection & exports
│   │   ├── synthetic.py           # Seedable clustered/uniform/gaussian generator (§2.8) + seed_summary (Phase G)
│   │   ├── distance.py            # Vectorized Haversine, Euclidean & Manhattan matrices
│   │   ├── optimization.py        # Weiszfeld (K=1), Weighted K-Means (K>1), PuLP MILP CFLP (+ road-aware assignment)
│   │   ├── cost.py                # Cost engine, traffic factor, fleet weighting, live fuel & metrics
│   │   ├── mapping.py             # Geospatial bounds, bubble sizing & map layer data
│   │   ├── scenarios.py           # Phase 5: Multi-K trade-off elbow, demand shift, fleet ETA, diagnostics
│   │   ├── simulation.py          # Phase F: realtime tick (demand wave + spillover) + Overview aggregate + tick_extras (Phase I)
│   │   ├── routing.py             # Road routing provider (TomTom Matrix v2 → OSRM → Haversine fallback)
│   │   ├── traffic.py             # Live TomTom flow + corridor history (5-min TTL, JSON persistence) + zone traffic (Phase L)
│   │   ├── fuel.py                # Live India fuel prices via RapidAPI (12h TTL + static fallback)
│   │   ├── census.py              # US Census ACS demand seeder (tract populations → daily_orders) + seed_summary (Phase G)
│   │   ├── expansion.py           # Incremental warehouse expansion (add K without moving existing sites)
│   │   ├── auth.py                # JWT auth (PBKDF2 passwords, HS256 tokens, file-backed store)
│   │   ├── userdata.py            # Per-user workspace persistence (warehouses/vehicles/demand/config)
│   │   └── api.py                 # FastAPI application & REST endpoints (39 routes + /traffic/zones, § API Reference)
│   ├── tests/                     # 159 automated unit, integration & acceptance tests (25 files)
│   ├── requirements.txt           # Python dependencies (FastAPI, PuLP, scikit-learn, etc.)
│   ├── pyproject.toml             # pytest config (pythonpath=".", testpaths=["tests"])
│   └── pytest.ini
├── frontend/                      # React 18 + TypeScript + Vite + Tailwind CSS + Mapbox GL
│   ├── src/
│   │   ├── App.tsx                # Router (/, /login, /signup, /app/:tab) + pipeline shell, localStorage per-account
│   │   ├── types/index.ts         # TS contracts (mirror schema.py) — NOTE: OptimizationConfig declared twice, needs merge
│   │   ├── services/api.ts        # REST client + offline fallbacks (localValidate, localGenerateSynthetic, localOptimizeNetwork)
│   │   ├── data/sample.ts         # Hyderabad sample seed
│   │   └── components/
│   │       ├── MapView.tsx            # Mapbox-GL map, bubbles ∝√orders, cluster colors, spider lines, R_max circles, roads/displacement toggle + live moves + zone overlay
│   │       ├── OptimizationPanel.tsx + OptimizationControls.tsx  # K 1-10, metric, capacity/radius/fuel/traffic/infra controls
│   │       ├── ComparisonDashboard.tsx # Baseline vs optimized cards, table, histogram, CSV exports
│   │       ├── ScenariosPanel.tsx     # Trade-off elbow, demand-shift slider, fleet ETA, diagnostics + realtime tick region + SimulationLive
│   │       ├── SimulationLive.tsx     # Phase I: live order-move feed + capacity meters per tick
│   │       ├── SeedResultsPanel.tsx   # Phase G: seed counts + browsable warehouses/vehicles/nodes/orders
│   │       ├── searchIndex.ts         # Phase J: unified token index (nodes/warehouses/vehicles/orders) + SearchHit contract
│   │       ├── WarehouseExpansion.tsx # Add/remove warehouses + before-after slider
│   │       ├── DataTable.tsx, FileUploader.tsx, SyntheticModal.tsx, CensusModal.tsx, ErrorDrawer.tsx
│   │       ├── AskPanel.tsx, Dashboard.tsx, DetailCard.tsx, ExportView.tsx, FuelCard.tsx, TrafficCard.tsx (zone legend)
│   │       ├── GmapsRail.tsx, MapChrome.tsx, Sidebar.tsx, Topbar.tsx, Header.tsx, SideCards.tsx
│   │       ├── SummaryCards.tsx, SavedPanel.tsx (Starred bookmarks tab), SettingsView.tsx, SectionOverview.tsx
│   │       ├── ZoneLegendEditor.tsx, UsageDonut.tsx, AuthPages.tsx, ProtectedRoute.tsx, LandingPage.tsx
│   │       └── mapThemes.ts, panelStore.ts
│   └── package.json               # mapbox-gl, react-router-dom, lucide-react, tailwind-merge
├── api/
│   ├── index.py                   # Vercel adapter only — re-exports backend app (≤35 lines)
│   ├── requirements.txt           # Pinned prod deps (keep in sync with backend/requirements.txt) + mangum needed for `vercel dev`
│   └── src/                       # Build-time copy of backend/src (committed; run `make sync-api` after backend edits)
├── data/samples/                  # hyderabad_demand.csv, neighborhoods_*.json, large_1000_nodes.csv, sample_with_errors.csv
├── docs/                          # problem_statement.md, prd.md, schema.md, phases.md, prompt.md
├── vercel.json                    # Monorepo: frontend/dist + /api/(.*)→api/index.py, SPA fallback, CORS
├── Makefile                       # setup, test, run-backend, run-frontend, build-frontend, sync-api
└── README.md
```

---

## Tech Stack

| Layer | Technology | Role |
| :--- | :--- | :--- |
| Solvers | Python 3.10+, NumPy, SciPy, scikit-learn, PuLP (CBC) | Weiszfeld median, Weighted K-Means k-means++, MILP CFLP (`y_k`, `x_{i,k}`) |
| Backend | FastAPI, Uvicorn, Pydantic v2 | Validation + `/api/*` endpoints, `/docs` |
| Frontend | React 18, Vite 5, TypeScript 5.3 | SPA, router, pipeline shell |
| Styling | Tailwind 3.4, Lucide | Responsive layout |
| Maps | Mapbox-GL 3.31, Geopy | Interactive map, bubbles, spider lines, road paths; Haversine distances |
| Live data | TomTom Traffic, RapidAPI fuel, US Census ACS | Congestion, ₹/L fuel (keys server-side only), real demand seeder |
| Testing | Pytest, httpx | 113 backend tests; frontend `tsc && vite build` (no unit tests yet) |

---

## Quick Start

Prerequisites: Python 3.10+, Node 18+ + `pnpm`, `uv` recommended.

```bash
make setup              # backend/.venv + pnpm install

# Terminal 1 — backend http://localhost:8000/docs
make run-backend        # backend/.venv/bin/uvicorn src.api:app --reload --port 8000 --app-dir backend

# Terminal 2 — frontend http://localhost:3000 (proxies /api → 8000)
make run-frontend

make test               # backend/.venv/bin/pytest -c backend/pyproject.toml backend/tests -v
pnpm --prefix frontend build  # tsc && vite build → frontend/dist
```

Env: copy `.env.example` → `.env` for optional `RAPIDAPI_KEY`, `TOMTOM_KEY`, `DATABASE_URL`. Never commit `.env`. Keys stay server-side; frontend uses same-origin `/api`.

---

## API Contracts (schema.md §6)

| Endpoint | Method | Notes |
| :--- | :--- | :--- |
| GET | `/api/health` | `{status, service, version}` |
| POST | `/api/validate` | Validate `Neighborhood[]` → `ValidationResult` |
| POST | `/api/config/validate` | Validate `OptimizationConfig` against active dataset |
| POST | `/api/optimize` | Weiszfeld / Weighted K-Means / PuLP MILP (+ road mode) → `OptimizationResult` |
| POST | `/api/expand` | Incrementally add warehouses without moving existing sites + policy recommendation (`policy`, `owned_vehicles` → NPV-ranked plans) |
| GET | `/api/synthetic` | Seedable `clustered`/`uniform`/`gaussian` generator (`N, lat_center, lon_center, spread_km, …`) |
| GET | `/api/census/cities` | List supported Census city presets |
| GET | `/api/census/demand` | Real tract demand (`city`, `orders_per_1000`) → `Neighborhood[]` |
| POST | `/api/upload` | Multipart CSV/JSON upload with alias auto-detection (`?dataset=neighborhoods\|vehicles\|warehouses`) + `POST /api/vehicles/validate`, `POST /api/warehouses/validate`, `GET /api/synthetic/vehicles\|warehouses` |
| POST | `/api/export/csv` / `/api/export/json` | Canonical dataset exports |
| POST | `/api/export/metrics` / `/api/export/assignments` | Metrics table / assignment table exports |
| POST | `/api/map/summary` | Map bounds, center, zoom + bubble styling |
| POST | `/api/map/coverage` / `/api/map/warehouse-focus` | City-wide continuous coverage zones + legend / isolated click-to-focus zone payload (Phase B, heatmap refreshed Sept 20 2026) |
| GET | `/api/fuel/rates` / `/api/fuel/price` | Live India fuel rates (RapidAPI) with static fallback |
| GET | `/api/traffic/flow` / `/api/traffic/history` | Live TomTom segment speed + rolling corridor history |
| POST | `/api/traffic/corridors` | Corridor congestion aggregated from road geometries (Phase C) |
| GET / POST | `/api/traffic/zones` | Dynamic zone traffic rings, centre-high → edge-low, red/yellow/green per tick (Phase L) |
| POST | `/api/routes/reroute` | `traffic_aware_reroute` (`α·cost + β·time`) with changed-assignments + saved minutes/₹ (Phase C) |
| POST | `/api/routes/geometry` | Traced road polylines for assignment pairs (TomTom → OSRM → fallback). Accepts `{frm|from}` spellings (Phase B fix); failures fall back to straight lines with a friendly notice. |
| POST | `/api/scenarios/tradeoff` | Multi-K infra-vs-delivery elbow curve |
| POST | `/api/scenarios/demand-shift` | Scale $w_i$ by $\Delta\%$ and re-evaluate |
| POST | `/api/scenarios/eta` | Fleet + traffic ETA (avg/max minutes, trips, fuel liters) |
| POST | `/api/scenarios/diagnostics` | Capacity utilization + $R_{\max}$ violation audit |
| POST | `/api/simulation/tick` | Realtime tick: demand wave + congestion spillover (stateless via `active_spills`) + `order_moves`/`capacity_updates`/`fuel_snapshot`/`zone_intensities` (Phase I) |
| POST | `/api/simulation/live` | Live fuel + corridor traffic + demand snapshot for one tick |
| POST | `/api/overview` | Overview aggregate (vehicles/fuel/infra/orders/costs/alerts) |
| POST | `/api/auth/signup` / `/api/auth/login` | PBKDF2 signup + HS256 login (24h TTL) |
| GET | `/api/auth/me` | Current user from `Authorization: Bearer <token>` |
| GET / PUT | `/api/user/data` | Per-user workspace (warehouses/vehicles/demand/config) persisted across sessions (JWT required) |

Canonical `Neighborhood`: `neighborhood_id (PK), name?, latitude [-90,90], longitude [-180,180], daily_orders int ≥0, zone?`. CSV header `neighborhood_id,name,latitude,longitude,daily_orders`. Aliases: `id→neighborhood_id, lat→latitude, lng|lon→longitude, orders|demand→daily_orders`.

`OptimizationConfig`: `K 1-10 (2), distance_metric haversine|euclidean|manhattan|road, capacity_enabled+C_max, radius_enabled+R_max_km, cost_per_km (1.0), fuel_cost_per_km, infra_cost_per_warehouse, traffic_factor, use_live_fuel/traffic, vehicle_fleet[], random_seed (42), baseline_mode centroid|mean|single_center|custom`.

---

## Completed Pipeline Features

### Phase 1: Data Ingestion & Validation
- CSV/JSON upload with delimiter sniff + alias mapping, manual add/edit/delete grid, duplicate-ID guard.
- Strict server+client validation (`OUT_OF_RANGE`, `NULL_OR_EMPTY`, `DUPLICATE_ID`, `EMPTY_DATASET`) in `ErrorDrawer`.
- Seedable synthetic (`clustered` city model + `uniform`/`gaussian`) + US Census real-demand seeder.
- Export CSV/JSON, per-account `localStorage` persistence.

### Phase 2: Location Visualization & Mapping
- Mapbox-GL map (`MapView.tsx`): bubbles ∝√orders, color by warehouse/zone/demand, tooltips, auto-fit bounds, basemap switch, layer chips.
- Controls: `K` selector, metric toggle (Haversine default), capacity/radius/fuel/traffic/infra toggles, road vs displacement lines.

### Phase 3: Optimization & Assignment
- `K=1` Weiszfeld geometric median; `K>1` Weighted K-Means (k-means++, `n_init=10`, Weiszfeld refine, `random_seed`).
- Constrained PuLP MILP CFLP: `min Σw·d·x + Σinfra·y`, single-assignment, `ΣK=C`, capacity `Σw·x ≤ C_max·y`, radius `x=0 if d>R_max`. `N≤500` MILP cap, greedy fallback + `infeasibility_reason`.
- Assignment table `neighborhood_id→warehouse_id + distance_km, weighted_distance, cost, within_radius, is_feasible, congestion_pct, travel_time_min`.

### Phase 4: Cost & Comparison
- Cost engine (`cost.py`): `Σd`, `Σw·d`, `Σw·d_eff·rate_eff + Σinfra`, `avg/order`, utilization, fuel liters, congestion %.
- Baseline modes (`centroid` default, `mean`, `single_center`, `custom`) evaluated with same economics; `ComparisonDashboard` cards + % saved, histogram, map spider lines + `R_max` circles; CSV exports match map.

### Phase 5: Scenarios & Bonus (8/8)
- Trade-off elbow `K=1..max_k` → `optimal_K`; demand-shift slider `-50%..+100%` + re-optimize; fleet ETA (E-Bike/Van/Truck, traffic-aware); capacity/radius diagnostics; warehouse expansion add/remove + before-after slider; live fuel/traffic (server keys, TTL-cached) with manual fallbacks.

---

## Bonus Features (8/8)

| # | Requirement | Implementation |
| :-: | :--- | :--- |
| 1 | Multiple warehouses | `optimization.py` Weighted K-Means + MILP, `K 1-10` |
| 2 | Limited capacity | `C_max` MILP + utilization gauges, `scenarios.py:diagnose_constraints` |
| 3 | Max radius | `R_max` MILP + circles + violation audit |
| 4 | Vehicle types | `VehicleType` fleet (capacity, cost/km, fuel, speed, mileage) |
| 5 | Fuel costs | `fuel_cost_per_km` + live ₹/L burn in `fuel.py`/`cost.py`, `FuelCard.tsx` |
| 6 | Traffic times | `traffic_factor` + live/history corridors in `traffic.py`, `TrafficCard.tsx`, ETA |
| 7 | Demand changes | `simulate_demand_shift`, slider + presets, `ScenariosPanel.tsx` |
| 8 | Infra vs delivery | `compute_tradeoff_curve`, elbow chart, `optimal_K` |

---

## Testing & Performance

```bash
make test  # 113 collected
```

Covers schema, validation, ingestion, synthetic (seeded), distance matrices, Weiszfeld/K-Means/MILP, cost hand-calcs (3 cases), API, acceptance N=1000 <5s + map <2s targets. Frontend verified via `tsc && vite build` (~6s).

---

## Deployment (Vercel Monorepo)

- Root `vercel.json` builds `frontend/dist`, routes `/api/(.*)` → `api/index.py`, SPA fallback to `/index.html`, CORS on `/api/*`.
- After backend edits: `make sync-api` then commit both `backend/src/` and `api/src/`.
- Split-deploy alternative: host frontend + backend separately, set `VITE_API_URL=https://<backend>.vercel.app`.

---

## Known Issues & Next Fixes

1. **Routes shape**: frontend sends `{from,to}` (`services/api.ts:243`, `App.tsx:110`), backend requires `{frm,to}` (`api.py:326`) → roads mode 400s. Fix: accept both keys. Verified: `from`=400, `frm`=200.
2. **Error swallowing**: `optimizeNetwork` falls back to local solver on `!res.ok` without surfacing backend 400 detail. Throw `apiErrorMessage` first.
3. **CBC arch**: PuLP bundles `osx/i64/cbc` (x86_64); Apple Silicon arm64 fails 2 MILP tests (`Bad CPU type`). Passes on Vercel Linux. Fix: arm64 CBC via `brew`/ `pulp[cbc]`.
4. **Duplicate type**: `OptimizationConfig` twice in `types/index.ts:38,173` (merges, but confusing). Merge to one; consider codegen from Pydantic.
5. **`api/requirements.txt`**: pinned copy missing `mangum`; keep in sync with `backend/requirements.txt`.
6. **Bundle**: `2.2MB JS / 630kB gzip` (mapbox-gl) — lazy-load map, `manualChunks`.
7. **Committed `api/src/__pycache__`** — gitignore it.

---

## AI Tools Disclosure

Per hackathon transparency: agentic coding assistants used for boilerplate, test scaffolding, and vectorization. Core formulas (Haversine matrices, Weiszfeld iteration, MILP `y_k`/`x_{i,k}` constraints, cost engine) engineered to `docs/schema.md` + `docs/prd.md` and verified by hand-calc tests.

---

## Authors & License

Built for **HACK-A-MATICS 2026** by the GRIDPOINT Team. MIT License.
