# AGENTS.md — GridPoint (Hackmatics_Grid_Point) Agent Guide

> **For AI agents and human contributors** working on this repo. Read this + `docs/` before any code change. All field names must match `docs/schema.md` exactly.

## 1. Project Overview

**GRIDPOINT — Where Should the Warehouse Go?** (`docs/problem_statement.md:1`, `docs/prd.md:1`)

E-commerce delivery optimization: each `Neighborhood` has `(latitude, longitude, daily_orders=w_i)`. Platform minimizes weighted cost:

```
min Σ w_i * d(n_i, w_assigned)      // docs/prd.md:4, docs/schema.md:135
```

**5-Step Pipeline (shipped, must stay demonstrable):**
```
Neighborhood Data → Location Visualization → Warehouse Optimization
                                              → Neighborhood Assignment
                                              → Delivery Cost Comparison
Bonus + Polish (shipped) + Overview (shipped — Phase F, `/app/overview` + `POST /api/overview`)
```

> **Docs-vs-code status (Sept 20 2026, read first):** `docs/phases.md` concurrent plan **Phases A–F** covering user backlog #1–#14 (`phases.md` §0) — **ALL SHIPPED** (Person 1: A onboarding trio with vehicle/warehouse CRUD + seeders, D per-order road+fuel cost truth + populated Fuel/Congestion/Feasibility fields + elbow, E expansion policy with abandon/sell/revenue; Person 2: B warehouse click-to-focus + coverage heatmap + `{frm|from}` roads fix + traffic overlay, C optimize-on-current-traffic + `traffic_aware_reroute` + corridor traffic, F realtime simulation tick + spillover + Overview tab). `docs/prd.md` §§5.1–5.11, `docs/schema.md` §§2.8–2.10 + traffic/simulation config fields, and `docs/demo_script.md` beats carry the shipped spec. `docs/problem_statement.md` requirements are frozen — its addendum is a pointer only.

Live prod URL (if deployed): `https://hackmatics-grid-point.vercel.app` (`README.md:7`). Auth store is file-backed JSON (`GRIDPOINT_USERS_FILE`, default `backend/data/users.json`; Vercel: `/tmp/gridpoint_users.json` — Neon `users` table = documented TODO in `backend/src/auth.py`); `DATABASE_URL`/`NEON_*` are env-plumbed via `.env.example:3`.

## 2. Repo Structure (Monorepo)

```
Hackmatics_Grid_Point/
├── docs/
│   ├── problem_statement.md  # 9 core req + 8 bonus (FROZEN) + Sept-2026 backlog pointer addendum
│   ├── prd.md                # PRD §5.1-5.11 (ALL SHIPPED Sept 20 2026: A §5.1 onboarding, B §5.2 map focus/heatmap, C §5.4 traffic routing, D §§5.6-5.7 cost truth, E §5.9 expansion advisor, F §§5.10-5.11 realtime + Overview)
│   ├── schema.md             # SINGLE SOURCE OF TRUTH for entities, validation, API contracts (§2.9 Overview aggregate SHIPPED; §2.10 ExpansionRecommendation SHIPPED)
│   ├── phases.md             # ⚠️ Sept 2026 concurrent plan Phases A–F for backlog #1–#14 (ALL SHIPPED Sept 20 2026); Appendix A = traceability matrix
│   ├── parallel_tracks.md    # Person 1 (A/D/E: data+cost+expansion) vs Person 2 (B/C/F: map+routing+realtime) sprint plan + dependency flow
│   └── prompt.md             # Phase 1 implementation prompt (archival) + backlog pointer
├── backend/                  # Python 3.10+ FastAPI shared core
│   ├── src/                  # 18 modules (mirror into api/src/ via `make sync-api`)
│   │   ├── schema.py         # Pydantic v2 models (Neighborhood, Warehouse, OptimizationConfig, Metrics, Comparison) — mirrors schema.md §2
│   │   ├── validation.py     # Strict validation engine (schema.md §4)
│   │   ├── data_ingestion.py # CSV/JSON parsers with alias mapping + export
│   │   ├── synthetic.py      # Seedable generator (schema.md §2.8: clustered/uniform/gaussian)
│   │   ├── distance.py       # Vectorized Haversine/Euclidean/Manhattan matrices (schema.md §5); road lives in routing.py
│   │   ├── optimization.py   # Weiszfeld (K=1), Weighted K-Means (K>1), PuLP MILP CFLP, road-aware assignment, evaluate & run_optimization (PRD §5.4)
│   │   ├── cost.py           # Cost engine incl. live fuel + congestion (schema.md §2.6, PRD §5.6)
│   │   ├── mapping.py        # Map bounds, bubble sizing, layer data (Phase 2)
│   │   ├── scenarios.py      # Trade-off elbow, demand shift, fleet ETA, diagnostics (Phase 5) + Phase F realtime card data
│   │   ├── simulation.py       # Phase F SHIPPED: realtime tick (demand wave + congestion spillover) + Overview aggregate
│   │   ├── routing.py        # Road provider: TomTom Matrix v2 → OSRM → Haversine (MAX_ROUTE_PAIRS=60, 15-min cache)
│   │   ├── traffic.py        # Live TomTom flow + corridor history JSON (5-min TTL)
│   │   ├── fuel.py           # Live India fuel via RapidAPI (12h TTL + static fallback)
│   │   ├── census.py         # US Census ACS seeder (tract pop → daily_orders, data/census_cache/)
│   │   ├── expansion.py      # Incremental expansion (MAX_WAREHOUSES=10)
│   │   ├── auth.py           # JWT (PBKDF2 + HS256, 24h TTL, file-backed JSON store; Neon TODO)
│   │   ├── userdata.py       # Per-user workspace (warehouses/vehicles/demand/config), file-backed; `GET`+`PUT /api/user/data`
│   │   └── api.py            # FastAPI app `app` (schema.md §6) — 39 routes (optimize, expand, scenarios, fuel, traffic, census, routes, simulation, overview, auth…)
│   ├── tests/                # 159 tests in 25 files: schema, validation, ingestion, synthetic, distance, optimization, cost, mapping, scenarios, expansion, routing, fuel, traffic, census, auth, api, acceptance phase1/2/3/5 + onboarding/cost-truth/expansion-policy + phase-B/phase-C/simulation + perf (N=1000 <5s)
│   ├── requirements.txt      # Floating deps (FastAPI/Uvicorn/Pydantic/Pandas/NumPy/SciPy/sklearn/PuLP/Geopy/pytest + httpx)
│   ├── pyproject.toml        # pytest config, pythonpath=".", testpaths=["tests"]
│   └── pytest.ini
├── frontend/                 # React 18 + Vite + TypeScript + Tailwind + Mapbox GL + React Router 7
│   ├── src/
│   │   ├── App.tsx           # Router (/, /login, /signup, /app/:tab) + per-user shell, Mapbox MapView, rail panels
│   │   ├── types/index.ts    # TS contracts (must mirror backend/src/schema.py) — incl. road metric, live fuel/traffic, fuel/congestion fields
│   │   ├── services/api.ts   # API client (VITE_API_URL || '/api', JWT headers) + offline fallbacks: localValidate, localOptimizeNetwork, synthetic/CSV builders
│   │   ├── context/AuthContext.tsx # JWT session (login/signup/logout, /api/auth/me, localStorage token)
│   │   ├── data/sample.ts    # Opt-in 10-node Hyderabad sample; accounts start EMPTY
│   │   └── components/       # GmapsRail (ask/saved/optimize/compare/data/lab/overview/export/settings/help), AskPanel, LandingPage, AuthPages, ProtectedRoute, Header, Topbar, Sidebar, SideCards, Dashboard, SectionOverview, SummaryCards, FileUploader, DataTable, SyntheticModal, CensusModal, MapView, MapChrome, OptimizationPanel, OptimizationControls, WarehouseExpansion, ComparisonDashboard, ScenariosPanel, OverviewTab, WarehouseFocusCard, FuelCard, TrafficCard, SavedPanel, ExportView, SettingsView, DetailCard, UsageDonut, ZoneLegendEditor, ErrorDrawer, mapThemes (Mapbox styles/token), panelStore (per-user storage, CSV builders, smartDefaults)
│   ├── vite.config.ts        # port 3000, dev proxy /api → 127.0.0.1:8000
│   └── package.json          # gridpoint-frontend (mapbox-gl, react-router-dom, lucide-react, vite, tailwind)
├── api/
│   ├── index.py              # ⚠️ 23-line Vercel ASGI adapter — re-exports api/src api.app (see §7)
│   ├── requirements.txt      # Pinned serverless deps (no uvicorn/pytest/httpx/mangum)
│   └── src/                  # Mirror of backend/src/* — DO NOT hand-edit; regenerate with `make sync-api`
├── data/samples/             # 7 files: hyderabad_demand.csv (20 rows), neighborhoods_canonical/aliased/sample/synthetic_3clusters JSON, sample_with_errors.csv, large_1000_nodes.csv (+ data/census_cache/ Clark County NV)
├── vercel.json               # Root monorepo config: pnpm build → frontend/dist, /api/(.*) → api/index.py, SPA fallback, CORS (see §7)
├── pnpm-workspace.yaml       # packages: ['frontend'] + allowBuilds.esbuild
├── package.json              # Monorepo scripts: build, dev:backend/frontend, build:frontend, test:backend, test
├── requirements.txt          # Pointer stub only (see api/ + backend/ requirements)
└── Makefile                  # setup, test, run-backend/frontend, build-frontend, sync-api (cp backend/src/*.py api/src/)
```

**Do NOT duplicate logic** between `backend/` and `api/`. `api/index.py` is a 23-line adapter; `api/src/` is a generated mirror — regenerate with `make sync-api`, never hand-edit.

## 3. Canonical Schemas — MUST Match Exactly (`docs/schema.md:3`)

### Neighborhood (PK)
```
neighborhood_id: string (required, unique, non-empty)
name?: string (max 100, defaults to neighborhood_id)
latitude: float [-90, 90]
longitude: float [-180, 180]
daily_orders: int ≥0  // weight w_i
zone?: string (free-form)
```
CSV canonical header: `neighborhood_id,name,latitude,longitude,daily_orders` (`docs/schema.md:50`)
Aliases on ingest (`backend/src/data_ingestion.py`): `id→neighborhood_id`, `lat→latitude`, `lng|lon→longitude`, `orders|demand→daily_orders` (`docs/schema.md:55`)

### Warehouse
`warehouse_id (W1..WK), latitude, longitude, capacity? (C_max), radius_km? (R_max), infra_cost?, assigned_orders (derived), utilization_pct (derived)` (`docs/schema.md:57`)

### OptimizationConfig
`K: 1-10 (default 2), distance_metric: haversine|euclidean|manhattan|road (default haversine), capacity_enabled, C_max, radius_enabled, R_max_km, cost_per_km (1.0), fuel_cost_per_km, infra_cost_per_warehouse, traffic_factor, use_live_fuel, fuel_state (Karnataka), fuel_city, use_live_traffic, traffic_hour, vehicle_fleet[], owned_warehouses[] + respect_owned (anchor to owned sites, owned baseline, fleet assignment), random_seed (42), baseline_mode, custom_baseline_warehouses` (`docs/schema.md:82`, `backend/src/schema.py:47`)
> ALL SHIPPED Sept 20 2026: `expansion_policy` (`POST /api/expand` accepts policy + owned_vehicles), `use_live_traffic_for_routing`, `traffic_aware_reroute`, `simulation_mode: off|realtime` (+ `simulation_congestion_threshold/hysteresis/cooldown_ticks`). Reference them as implemented.

### Assignment / Metrics / Comparison
See `docs/schema.md:101` — `distance_km (km), weighted_distance=w_i*d, cost, fuel_cost, congestion_pct, travel_time_min (road), within_radius, is_feasible`. Metrics: `total_unweighted_distance_km=Σd_i`, `total_weighted_distance=Σw_i*d_i`, `total_cost=Σw_i*d_i*cost_per_km+Σinfra`, `total_fuel_cost`, `fuel_live`, `avg_congestion_pct`, `avg_distance_per_order`, `feasibility_ratio` (`docs/schema.md:130`, `backend/src/schema.py:130`). `OptimizationResult` also carries `fuel_note/traffic_note/routing_note`.

## 4. Validation Rules (`docs/schema.md:208`, `backend/src/validation.py`)

| Check | Level | Code |
|-------|-------|------|
| lat ∉ [-90,90] | Error | OUT_OF_RANGE |
| lon ∉ [-180,180] | Error | OUT_OF_RANGE |
| daily_orders non-int / <0 | Error | OUT_OF_RANGE/NULL_VALUE |
| neighborhood_id null/empty/duplicate | Error | NULL_OR_EMPTY/DUPLICATE_ID |
| empty dataset | Error | EMPTY_DATASET |
| Σ C_max < Σ w_i / K out of 1-10 | Error | — |
| C_max < max w_i, N>1000 with MILP, R_max coverage | Warning | — |

Error shape: `{"row":3,"field":"latitude","value":120.5,"error":"...","code":"OUT_OF_RANGE"}` (`docs/schema.md:225`)

Client fallback `frontend/src/services/api.ts:88 localValidate()` must stay in sync with `backend/src/validation.py`.

## 5. API Contracts (`docs/schema.md:244`, `backend/src/api.py` — 39 routes)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | `{status, service, version}` |
| `/api/validate` | POST `{neighborhoods:[]}` | `ValidationResult` |
| `/api/config/validate` | POST `{config, neighborhoods}` | Config-vs-data feasibility check |
| `/api/optimize` | POST `{neighborhoods: Neighborhood[], config?: OptimizationConfig}` | `OptimizationResult` — Weiszfeld/K-Means or PuLP MILP (+ road mode), returns `{warehouses, assignments, metrics, comparison, is_feasible, fuel_note/traffic_note/routing_note}` |
| `/api/expand` | POST | Incremental expansion + SHIPPED policy recommendation (allow_abandon/sell, horizon, revenue) |
| `/api/synthetic?N=&lat_center=&lon_center=&spread_km=&distribution=&num_clusters=&orders_min=&orders_max=&seed=` | GET | `Neighborhood[]` |
| `/api/census/cities` | GET | Supported Census city presets |
| `/api/census/demand?city=&orders_per_1000=` | GET | Real ACS tract demand → `Neighborhood[]` |
| `/api/upload` | POST multipart `file` (`?dataset=neighborhoods\|vehicles\|warehouses\|assignments`) | SHIPPED trio ingest + assignments plan import + `POST /api/vehicles/validate, POST /api/warehouses/validate, POST /api/assignments/validate, GET /api/synthetic/vehicles\|warehouses, POST /api/export/vehicles\|warehouses\|assignments-imported` |
| `/api/export/csv` | POST `{neighborhoods}` | CSV text |
| `/api/export/json` | POST `{neighborhoods}` | JSON text |
| `/api/export/metrics` | POST | Metrics table export |
| `/api/export/assignments` | POST | Assignment table export |
| `/api/map/summary` | POST `{neighborhoods}` | Bounds, center, zoom + bubble styling |
| `/api/map/coverage` | POST | SHIPPED Phase B: green→red proximity heatmap cells + legend; UPDATED Sept 20 2026: city-wide padded bounds + `bounds`/`cell_step`, rendered as continuous zone polygons |
| `/api/map/warehouse-focus` | POST | SHIPPED Phase B: isolated zone payload for a clicked warehouse (`warehouse_focus_summary`) |
| `/api/fuel/rates?state=` | GET | Live India fuel rates + fallback (`live` flag) |
| `/api/fuel/price` | GET | Single fuel price lookup |
| `/api/traffic/flow` | GET | Live TomTom segment speed |
| `/api/traffic/history` | GET | Rolling corridor history |
| `/api/traffic/corridors` | POST | SHIPPED Phase C: corridor congestion aggregated from road geometries |
| `/api/routes/reroute` | POST | SHIPPED Phase C: `traffic_aware_reroute` (`α·cost + β·time`) with changed-assignments + saved minutes/₹ |
| `/api/routes/geometry` | POST | Traced road polylines (TomTom → OSRM → fallback). SHIPPED Phase B fix (#3): accepts BOTH `{frm:{lat,lon}}` and `{from:{lat,lon}}` spellings (`backend/src/api.py` `_parse_route_pair`); failures map to a friendly notice with straight-line fallback + traced/total counter. |
| `/api/scenarios/tradeoff` | POST | Multi-K elbow curve |
| `/api/scenarios/demand-shift` | POST | Scale $w_i$ by Δ% and re-evaluate |
| `/api/scenarios/eta` | POST | Fleet + traffic ETA |
| `/api/scenarios/diagnostics` | POST | Capacity + $R_{\max}$ audit |
| `/api/simulation/tick` | POST | SHIPPED Phase F: realtime tick (demand wave + congestion spillover, stateless via `active_spills`) |
| `/api/simulation/live` | POST | SHIPPED Phase F: live fuel + corridor traffic + demand snapshot for one tick |
| `/api/overview` | POST | SHIPPED Phase F: Overview aggregate (vehicles/fuel/infra/orders/costs/alerts) |
| `/api/auth/signup` | POST | PBKDF2 signup → JWT (24h TTL) |
| `/api/auth/login` | POST | Login → JWT |
| `/api/auth/me` | GET | Current user via `Authorization: Bearer` |
| `/api/user/data` | GET / PUT | Per-user workspace (warehouses/vehicles/demand/assignments/config), JWT required; pull on login, debounced push; file-backed (`GRIDPOINT_DATA_FILE`) |

Always keep CORS `allow_origins=["*"]` (`backend/src/api.py:35`) for Vercel proxy.

## 6. Commands (Use These)

```bash
make setup              # backend/.venv + pnpm install
make run-backend        # FastAPI: backend/.venv/bin/uvicorn src.api:app --reload --port 8000 --app-dir backend → http://localhost:8000/docs
make run-frontend       # Vite: pnpm --prefix frontend dev → http://localhost:3000 (proxy /api → 8000)
make test               # pytest: backend/.venv/bin/pytest -c backend/pyproject.toml backend/tests -v  (159 tests: distance, optimization, cost, routing, fuel, traffic, census, auth, acceptance + onboarding/cost-truth/expansion-policy + phase-B/phase-C/simulation)
make sync-api           # cp backend/src/*.py api/src/ — required after any backend/src change (Vercel serves api/src)
pnpm --prefix frontend build   # tsc && vite build → frontend/dist
# Quick backend smoke: python -c "from src.api import app; print([r.path for r in app.routes])" --app-dir backend
# Optimize smoke: curl -X POST http://localhost:8000/api/optimize -H "Content-Type: application/json" -d '{"neighborhoods":[...], "config":{"K":2}}'
```

Local dev needs 2 terminals (backend + frontend) plus `VITE_MAPBOX_TOKEN` in `frontend/.env.local` (Mapbox GL is required even locally).

Env: copy `.env.example` → `.env` (Neon `DATABASE_URL`, `NEON_PROJECT_ID`, plus server-only `RAPIDAPI_KEY`, `TOMTOM_KEY`, `CENSUS_KEY`) — never commit `.env` (`.gitignore:48`). Without live keys the API serves static fallbacks with `live=false`.

## 7. Vercel Hosting — Frontend + Backend

### Current Config (Monorepo Single Domain)
- **Root `vercel.json:1`** installs with pnpm, builds `frontend/dist` (`pnpm run build`), bundles `api/src/**` into the Python function, routes `/api/(.*)` → `api/index.py`, SPA fallback `/(.*)` → `/index.html`, CORS headers for `/api/*`.
- **`api/index.py:1`** is *adapter*, not new backend: inserts `api/` into `sys.path` and `from src.api import app` (serves the `api/src/` mirror). Vercel native ASGI; `mangum` optional compat.
- **`api/requirements.txt:1`** pins serverless deps (`fastapi==`, `pydantic==`, `pandas==`, `numpy==`, `scipy==`, `scikit-learn==`, `pulp==`, `geopy==`) — intentionally separate from floating `backend/requirements.txt` (which adds `uvicorn`, `pytest`, `httpx`). After any `backend/src` change run `make sync-api`.
- **Frontend `frontend/src/services/api.ts:24`** uses `VITE_API_URL || '/api'` + JWT `Authorization` headers — same-origin for monorepo, or absolute backend URL for split deploy. Ships offline fallbacks (`localValidate`, `localOptimizeNetwork`, synthetic/CSV builders).
- **`pnpm-workspace.yaml:3`** `allowBuilds: esbuild=true` required for Vite on Vercel (otherwise ERR_PNPM_IGNORED_BUILDS).

### Why Not Just `backend/`?
Vercel only discovers Python functions in `api/*.py` at repo root. Keeping `backend/` clean avoids mixing build toolchains; `api/index.py` stays a 23-line adapter over the generated `api/src/` mirror.

### Alternative (Split Deploy, no `api/` folder)
If deleting `api/`: deploy `frontend/` as one Vercel project and `backend/` as standalone Python project, then set `VITE_API_URL=https://<backend>.vercel.app` in frontend env. Requires separate `vercel link --cwd backend`.

### Deploy Steps
```bash
vercel whoami                  # logged as shrihariviswanathan-3176
vercel link --yes               # or vercel link --project hackmatics-grid-point --team nazu777-s-projects
vercel --prod --yes             # deploys monorepo
vercel ls / vercel project ls   # verify
```
`frontend/vercel.json` does not exist — only the root `vercel.json` is used. There is no standalone frontend deploy config in the repo.

## 8. Implementation Status vs Planned Phases (SYNCED Sept 20 2026)

**Shipped (do not regress):**
- **Ingestion ✅ (Phase A SHIPPED)** — neighborhoods + owned vehicles + existing warehouses (CSV/JSON upload with `?dataset=`, manual tables, synthetic + Census ACS + opt-in Hyderabad sample, per-account EMPTY 0/0/0 + checklist, JWT-gated). Seeds: `data/samples/vehicles_seed.*, warehouses_seed.*` + `GET /api/synthetic/vehicles|warehouses` (seed=42).
- **Map ✅ (Phase B SHIPPED, heatmap refreshed Sept 20 2026)** — Mapbox GL (Standard/Light/Dark), bubbles ∝√orders, displacement/road lines, R_max circles + road isochrones, layer chips, Gmaps rail (`ask/saved/optimize/compare/data/lab/overview/export/settings/help`). Click-to-focus zone card (`WarehouseFocusCard.tsx`, `POST /api/map/warehouse-focus`), city-wide continuous coverage zones — padded bounds + contiguous `fill` polygons via `bounds`/`cell_step` (`POST /api/map/coverage`), corridor-traffic overlay from traced roads, `{frm|from}` roads fix with friendly fallback (never raw `Pair #0…`).
- **Optimization ✅ (Phase C SHIPPED)** — Haversine/Euclidean/Manhattan + road mode, Weiszfeld K=1, weighted K-Means K>1, PuLP MILP CFLP, road-aware assignment, incremental expansion (`POST /api/expand` + policy recommendation). Optimize-on-current-traffic (`use_live_traffic_for_routing`) + `traffic_aware_reroute` (`α·cost + β·time`, `POST /api/routes/reroute` + `POST /api/traffic/corridors`) with `traffic_note`/`routing_note` provenance.
- **Cost/compare ✅ (Phase D SHIPPED)** — per-order road+fuel truth (`per_order_breakdown`, `assignment_table_rows`), baseline-vs-optimized dashboard with per-node avg cost/order, populated Fuel-portion/Avg-congestion/Feasibility fields, annotated infra-vs-delivery elbow (`TradeoffElbow.tsx`), CSV exports with fuel columns.
- **Expansion ✅ (Phase E SHIPPED)** — keep-vs-abandon/demolish + keep-vs-sell policy (`expansion_policy`, `horizon_months`, `revenue_per_order`), ranked NPV recommendation with costed rationale + before/after map.
- **Scenarios + realtime ✅ (Phase F SHIPPED)** — elbow trade-off, demand-shift, fleet ETA, diagnostics + Fuel/Traffic cards; live-feed automation via `simulation_mode=realtime` (`POST /api/simulation/tick|live`, `backend/src/simulation.py`, threshold + hysteresis + cooldown, spillover event log; sliders survive as collapsed offline overrides) + Overview tab (`/app/overview`, `POST /api/overview`, `OverviewTab.tsx`).

**All six phases shipped (nothing remaining planned):** A Onboarding (#4, #6, #8) · B Map UX (#1–#3, #5-display) · C Traffic-aware routing (#5-opt, #9, #12-engine) · D Cost truth (#7, #10) · E Expansion advisor (#11) · F Realtime automation + Overview (#12-UI, #13, #14). Shared frozen interfaces in `phases.md` §1; traceability in Appendix A.

Next (code): standing items — Neon-backed `users` table, production secrets via `vercel env add … production`, demo video refresh (see `docs/demo_script.md`). Follow-up user backlog #4–#9 is planned as parallel phases G–L in `docs/followup_phases.md` (seed-viz, bookmarks, sim-live, search, auto-radius, zone-traffic) with frozen shared contracts in §1.

Traceability: `docs/phases.md` Appendix A + `docs/prd.md` §4.

## 9. Coding Standards for Agents

- **Production-ready, modular, no pseudocode** (`docs/prompt.md:45`). Type-safe (Pydantic v2 + TS), fully runnable.
- **Validate all inputs**, user-friendly inline errors, no crash on 10-1000 rows.
- **Seeded RNG** for K-Means + synthetic (`random_seed` / `seed`).
- **Units**: WGS84 degrees in, km out (Haversine), cost INR (live fuel in ₹/L via RapidAPI India).
- **File naming**: keep `backend/src/*.py`, `frontend/src/components/*.tsx` pattern; follow `docs/phases.md` Appendix B. Never hand-edit `api/src/*` — run `make sync-api`.
- **No magic strings**: reuse schema field names; use `backend/src/schema.py` as import source.
- **Perf**: N=1000 <5s optimize, map <2s. Road mode is provider-bound: batch ≤12-pair chunks with progressive rendering.
- **Testing**: add pytest for new logic under `backend/tests/`, keep `make test` green (159 tests) before commit.
- **Docs**: update `README.md` Architecture tree if adding modules; `docs/*.md` may be edited to stay in sync (`problem_statement.md` requirements are frozen — its addendum is a pointer only).
- **Frontend**: Mapbox token required (`frontend/.env.local` → `VITE_MAPBOX_TOKEN`); accounts start EMPTY — never auto-load sample data; keep per-user `localStorage` namespacing (`gridpoint_*_<uid>`); keep offline fallbacks in `services/api.ts` in sync with backend.
- **Git**: `git@github.com:nazu777/Hackmatics_Grid_Point.git` — remote uses `https://` locally (SSH publickey denied); `main` branch.

## 10. Do / Don't

| Do | Don't |
|----|-------|
| Run `pnpm approve-builds --all` if Vite build fails on esbuild | Bypass pnpm supply-chain policy silently |
| Check `frontend/dist` build + `python -c "from src.api import app"` after changes | Assume backend works without import test |
| Keep `frontend/src/services/api.ts:24` VITE_API_URL fallback | Hardcode localhost URLs for prod |
| Add `allowBuilds.esbuild` in pnpm-workspace for Vercel | Commit `.env`, `.vercel/`, `node_modules/`, `dist/` |
| Handle infeasible MILP with `ΣC_max≥Σw_i` pre-check + greedy fallback | Silently assign infeasible warehouses |

## 11. Quick Agent Checklist (Before PR)

1. `make test` passes (159 tests: `test_optimization.py` covers Weiszfeld/K-Means/MILP, plus routing/fuel/traffic/census/auth + onboarding/cost-truth/expansion-policy + phase-B/phase-C/simulation) + `pnpm --prefix frontend build` succeeds ?
2. Schemas still match `docs/schema.md` (field names, ranges, alias mapping)? Check `backend/src/schema.py:121 WarehouseMetric`, `130 Metrics`, `168 OptimizationResult`.
3. `api/index.py` still a 23-line adapter and `api/src/` matches `backend/src/` (`make sync-api` run)? Check `backend/src/api.py` optimize + expand routes.
4. `vercel.json` rewrites preserve `/api/*` before SPA catch-all? Test `curl /api/health` + `/api/optimize`.
5. Updated `README.md` if architecture changed? No secrets committed (`git status`)? Distance `backend/src/distance.py` dispatcher covers haversine|euclidean|manhattan (road lives in `routing.py`).

---

*References: `docs/problem_statement.md`, `docs/prd.md`, `docs/schema.md`, `docs/phases.md`, `docs/prompt.md`, `README.md`, `backend/src/schema.py`, `backend/src/api.py`, `frontend/src/services/api.ts`, `vercel.json`, `api/index.py`, `Makefile`.*
