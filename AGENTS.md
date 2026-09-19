# AGENTS.md — GridPoint (Hackmatics_Grid_Point) Agent Guide

> **For AI agents and human contributors** working on this repo. Read this + `docs/` before any code change. All field names must match `docs/schema.md` exactly.

## 1. Project Overview

**GRIDPOINT — Where Should the Warehouse Go?** (`docs/problem_statement.md:1`, `docs/prd.md:1`)

E-commerce delivery optimization: each `Neighborhood` has `(latitude, longitude, daily_orders=w_i)`. Platform minimizes weighted cost:

```
min Σ w_i * d(n_i, w_assigned)      // docs/prd.md:4, docs/schema.md:135
```

**5-Step Pipeline (must stay demonstrable, `docs/phases.md:2`):**
```
Neighborhood Data (Phase 1) → Location Visualization (Phase 2) → Warehouse Optimization (Phase 3)
                                                            → Neighborhood Assignment (Phase 3)
                                                            → Delivery Cost Comparison (Phase 4)
Bonus + Polish → Phase 5
```

Live prod URL (if deployed): `https://hackmatics-grid-point.vercel.app` (`README.md:7`). DB: Neon Postgres (`README.md:8`, `.env.example:3`).

## 2. Repo Structure (Monorepo)

```
Hackmatics_Grid_Point/
├── docs/
│   ├── problem_statement.md  # 9 core req + 8 bonus (§Bonus Features)
│   ├── prd.md                # PRD §5.1-5.8, pipeline traceability
│   ├── schema.md             # SINGLE SOURCE OF TRUTH for entities, validation, API contracts
│   ├── phases.md             # Sprint plan Phases 1-5, Appendix A traceability
│   └── prompt.md             # Phase 1 implementation prompt
├── backend/                  # Python 3.10+ FastAPI shared core
│   ├── src/
│   │   ├── schema.py         # Pydantic v2 models (Neighborhood, Warehouse, OptimizationConfig, Metrics, Comparison) — mirrors schema.md §2
│   │   ├── validation.py     # Strict validation engine (schema.md §4)
│   │   ├── data_ingestion.py # CSV/JSON parsers with alias mapping + export
│   │   ├── synthetic.py      # Seedable generator (schema.md §2.8: clustered/uniform/gaussian)
│   │   ├── distance.py       # Vectorized Haversine/Euclidean/Manhattan matrices (schema.md §5) — NEW Phase 3
│   │   ├── optimization.py   # Weiszfeld (K=1), Weighted K-Means (K>1), PuLP MILP CFLP, evaluate & run_optimization (PRD §5.4) — NEW Phase 3
│   │   └── api.py            # FastAPI app `app` (schema.md §6) — now includes POST /api/optimize
│   ├── tests/                # 50+ tests: schema, validation, ingestion, synthetic, distance, optimization, api, acceptance+perf (N=1000 <5s, 1000-node MILP <10s)
│   ├── requirements.txt      # FastAPI/Uvicorn/Pydantic/Pandas/NumPy/SciPy/sklearn/PuLP/Geopy/pytest + httpx
│   ├── pyproject.toml        # pytest config, pythonpath="."
│   └── pytest.ini
├── frontend/                 # React 18 + Vite + TypeScript + Tailwind
│   ├── src/
│   │   ├── App.tsx           # Phase-state shell, localStorage, now integrates OptimizationPanel (Phase 3)
│   │   ├── types/index.ts    # TS contracts (must mirror backend/src/schema.py) — now includes OptimizationConfig/Result, Metrics, WarehouseMetric
│   │   ├── services/api.ts   # API client, fallback localValidate + localOptimizeNetwork (Weiszfeld/K-Means JS), VITE_API_URL support, POST /api/optimize
│   │   └── components/       # Header, SummaryCards, FileUploader, DataTable, SyntheticModal, ErrorDrawer, OptimizationPanel (NEW Phase 3)
│   ├── vite.config.ts        # dev proxy /api → 127.0.0.1:8000
│   └── vercel.json           # SPA fallback (standalone frontend deploy)
├── api/
│   ├── index.py              # ⚠️ Vercel adapter only — re-exports backend/src/api.py `app` (see §7)
│   └── requirements.txt      # -r ../backend/requirements.txt + mangum
├── data/samples/             # hyderabad_demand.csv, neighborhoods_*.json, large_1000_nodes.csv (perf benchmark), sample_with_errors.csv
├── vercel.json               # Root Vercel monorepo config (frontend + backend, see §7)
├── pnpm-workspace.yaml       # pnpm workspace: frontend + allowBuilds.esbuild
├── package.json              # Monorepo scripts: build, dev:backend/frontend, test
├── requirements.txt          # Root: -r backend/requirements.txt
└── Makefile                  # setup, test, run-backend/frontend, build-frontend
```

**Do NOT duplicate logic** between `backend/` and `api/`. `api/index.py` is a 30-line wrapper.

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
`K: 1-10 (default 2), distance_metric: haversine|euclidean|manhattan (default haversine), capacity_enabled, C_max, radius_enabled, R_max_km, cost_per_km (1.0), fuel_cost_per_km, infra_cost_per_warehouse, traffic_factor, vehicle_fleet[], random_seed (42), baseline_mode, custom_baseline_warehouses` (`docs/schema.md:82`)

### Assignment / Metrics / Comparison
See `docs/schema.md:101` — `distance_km (km), weighted_distance=w_i*d, cost, within_radius, is_feasible`. Metrics: `total_unweighted_distance_km=Σd_i`, `total_weighted_distance=Σw_i*d_i`, `total_cost=Σw_i*d_i*cost_per_km+Σinfra`, `avg_distance_per_order`, `feasibility_ratio` (`docs/schema.md:130`).

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

## 5. API Contracts (`docs/schema.md:244`, `backend/src/api.py`)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | `{status, service, version}` |
| `/api/validate` | POST `{neighborhoods:[]}` | `ValidationResult` (`backend/src/api.py:64`) |
| `/api/optimize` | POST `{neighborhoods: Neighborhood[], config?: OptimizationConfig}` | `OptimizationResult` — Weiszfeld/K-Means or PuLP MILP, returns `{warehouses, assignments, metrics, comparison, is_feasible}` (`backend/src/api.py:71`, `backend/src/optimization.py:409`) |
| `/api/synthetic?N=&lat_center=&lon_center=&spread_km=&distribution=&num_clusters=&orders_min=&orders_max=&seed=` | GET | `Neighborhood[]` |
| `/api/upload` | POST multipart `file` | `{filename, validation, neighborhoods, summary}` — auto CSV/JSON detection |
| `/api/export/csv` | POST `{neighborhoods}` | CSV text |
| `/api/export/json` | POST `{neighborhoods}` | JSON text |

Always keep CORS `allow_origins=["*"]` (`backend/src/api.py:35`) for Vercel proxy.

## 6. Commands (Use These)

```bash
make setup              # backend/.venv + pnpm install
make run-backend        # FastAPI: backend/.venv/bin/uvicorn src.api:app --reload --port 8000 --app-dir backend → http://localhost:8000/docs
make run-frontend       # Vite: pnpm --prefix frontend dev → http://localhost:3000 (proxy /api → 8000)
make test               # pytest: backend/.venv/bin/pytest -c backend/pyproject.toml backend/tests -v  (50+ tests, includes distance, optimization, acceptance_phase3)
pnpm --prefix frontend build   # tsc && vite build → frontend/dist (verified <18s, gzip ~56kB)
# Quick backend smoke: python -c "from src.api import app; print([r.path for r in app.routes])" --app-dir backend
# Optimize smoke: curl -X POST http://localhost:8000/api/optimize -H "Content-Type: application/json" -d '{"neighborhoods":[...], "config":{"K":2}}'
```

Local dev needs 2 terminals (backend + frontend).

Env: copy `.env.example` → `.env` (Neon `DATABASE_URL`, `NEON_PROJECT_ID`) — never commit `.env` (`.gitignore:48`).

## 7. Vercel Hosting — Frontend + Backend

### Current Config (Monorepo Single Domain)
- **Root `vercel.json:1`** builds `frontend/dist` (`pnpm run build`), routes `/api/(.*)` → `api/index.py` (Python 3.11), SPA fallback `/(.*)` → `/index.html`, CORS headers for `/api/*`.
- **`api/index.py:1`** is *adapter*, not new backend: injects `backend/` into `sys.path` and `from src.api import app`. Vercel native ASGI; `mangum` optional compat (`api/index.py:30`).
- **`api/requirements.txt:1`** pins `-r ../backend/requirements.txt` + `mangum` so function has same deps as root `requirements.txt:2`.
- **Frontend `frontend/src/services/api.ts:4`** uses `VITE_API_URL || '/api'` — same-origin for monorepo, or absolute backend URL for split deploy.
- **`pnpm-workspace.yaml:3`** `allowBuilds: esbuild=true` required for Vite on Vercel (otherwise ERR_PNPM_IGNORED_BUILDS).

### Why Not Just `backend/`?
Vercel only discovers Python functions in `api/*.py` at repo root. Keeping `backend/` clean avoids mixing build toolchains; `api/index.py` stays ≤35 lines.

### Alternative (Split Deploy, no `api/` folder)
If deleting `api/`: deploy `frontend/` as one Vercel project and `backend/` as standalone Python project, then set `VITE_API_URL=https://<backend>.vercel.app` in frontend env. Requires separate `vercel link --cwd backend`.

### Deploy Steps
```bash
vercel whoami                  # logged as shrihariviswanathan-3176
vercel link --yes               # or vercel link --project hackmatics-grid-point --team nazu777-s-projects
vercel --prod --yes             # deploys monorepo
vercel ls / vercel project ls   # verify
```
`frontend/vercel.json:1` is fallback for frontend-only deploys; root `vercel.json` takes precedence on `vercel --cwd .`

## 8. Phase Progress & Next Steps

- **Phase 1 ✅ DONE** (`docs/phases.md:8`, `1b09bc4`): ingestion, validation, synthetic, export, tests (1000 nodes <0.2s, 31 passing). Deliverable: validated DataFrame/session.
- **Phase 2 ✅ DONE** (`frontend/src/components/MapView.tsx:1`, `backend/src/mapping.py:1`): Leaflet map (OSM tiles), bubbles ∝√orders (`mapping.py:32 bubble_radius`, `MapView.tsx:62`), cluster colors per warehouse (`warehouse_color`), auto-fit bounds + single-point guard (`fit_bounds`), polylines neighborhood→warehouse (`assignment_lines`), R_max circles, layer legend. K/metric/constraint panel lives in OptimizationPanel (Phase 3).
- **Phase 3 ✅ DONE** (`1b09bc4 feat(phase3)` `backend/src/distance.py:1`, `backend/src/optimization.py:1`): distance matrix (Haversine `backend/src/distance.py:11`, Euclidean `45`, Manhattan `70` + `*111km`), Weiszfeld K=1 `backend/src/optimization.py:26`, weighted K-Means K>1 `78` with k-means++ & Weiszfeld refine, MILP CFLP `122` PuLP `y_k,x_{i,k}` + infra cost + capacity `191` + radius `199`, assignment via `evaluate_network_layout:245`, baseline `compute_baseline_layout:367`, main `run_optimization:409` (<5s for N=1000, N≤500 MILP cutoff). Frontend fallback `frontend/src/services/api.ts:280 localOptimizeNetwork` mirrors logic in JS. Tests: `backend/tests/test_distance.py`, `test_optimization.py`, `test_acceptance_phase3.py`.
- **Phase 4 ✅ DONE** (`backend/src/cost.py:1`, `backend/src/mapping.py:1`): cost engine `effective_rate/effective_distance/assignment_cost/compute_metrics/compute_comparison/distance_histogram/metrics_table_rows` (traffic `d*(1+traffic_factor)` + fleet-weighted rate + infra); `optimization.py:245 evaluate_network_layout` delegates to it; new `POST /api/export/metrics` + `/api/export/assignments` (`backend/src/api.py:179`); frontend `MapView.tsx` + `ComparisonDashboard.tsx` (cards, table, histogram, CSV exports) wired to App Phase 2/4; tests `backend/tests/test_cost.py` (3 hand-calcs).
- **Phase 5 TODO** (`docs/phases.md:65`): bonus toggles (vehicles/fuel/traffic/demand/infra trade-off chart), polish, README, 2-3min demo video script (pipeline order).

Traceability: `docs/phases.md:86` + `docs/prd.md:22`.

## 9. Coding Standards for Agents

- **Production-ready, modular, no pseudocode** (`docs/prompt.md:45`). Type-safe (Pydantic v2 + TS), fully runnable.
- **Validate all inputs**, user-friendly inline errors, no crash on 10-1000 rows.
- **Seeded RNG** for K-Means + synthetic (`random_seed` / `seed`).
- **Units**: WGS84 degrees in, km out (Geopy Haversine), cost INR.
- **File naming**: keep `backend/src/*.py`, `frontend/src/components/*.tsx` pattern; follow Appendix B (`docs/phases.md:100`).
- **No magic strings**: reuse schema field names; use `backend/src/schema.py` as import source.
- **Perf**: N=1000 <5s optimize, map <2s.
- **Testing**: add pytest for new logic under `backend/tests/`, keep `make test` green before commit.
- **Docs**: update `README.md` Architecture tree if adding modules; never edit `docs/*.md` unless task says so.
- **Git**: `git@github.com:nazu777/Hackmatics_Grid_Point.git` — remote uses `https://` locally (SSH publickey denied); `main` branch.

## 10. Do / Don't

| Do | Don't |
|----|-------|
| Run `pnpm approve-builds --all` if Vite build fails on esbuild | Bypass pnpm supply-chain policy silently |
| Check `frontend/dist` build + `python -c "from src.api import app"` after changes | Assume backend works without import test |
| Keep `frontend/src/services/api.ts:4` VITE_API_URL fallback | Hardcode localhost URLs for prod |
| Add `allowBuilds.esbuild` in pnpm-workspace for Vercel | Commit `.env`, `.vercel/`, `node_modules/`, `dist/` |
| Handle infeasible MILP with `ΣC_max≥Σw_i` pre-check + greedy fallback | Silently assign infeasible warehouses |

## 11. Quick Agent Checklist (Before PR)

1. `make test` passes (50+ tests, `test_optimization.py:1` covers Weiszfeld/K-Means/MILP) + `pnpm --prefix frontend build` succeeds ?
2. Schemas still match `docs/schema.md` (field names, ranges, alias mapping)? Check `backend/src/schema.py:112 WarehouseMetric`, `121 Metrics`, `156 OptimizationResult`.
3. `api/index.py` still ≤35 lines and only wraps `backend/src/api.py`? Check `backend/src/api.py:71` optimize route.
4. `vercel.json` rewrites preserve `/api/*` before SPA catch-all? Test `curl /api/health` + `/api/optimize`.
5. Updated `README.md` if architecture changed? No secrets committed (`git status`)? Distance `backend/src/distance.py:94 compute_distance_matrix` dispatcher covers haversine|euclidean|manhattan.

---

*References: `docs/problem_statement.md`, `docs/prd.md`, `docs/schema.md`, `docs/phases.md`, `docs/prompt.md`, `README.md`, `backend/src/schema.py`, `backend/src/api.py`, `frontend/src/services/api.ts`, `vercel.json`, `api/index.py`, `Makefile`.*
