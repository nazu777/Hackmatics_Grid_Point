# GRIDPOINT — Where Should the Warehouse Go?

> **Warehouse Location & Assignment Optimization Platform**  
> Built for the **HACK-A-MATICS** Hackathon.  
> Aligned to [problem_statement.md](docs/problem_statement.md), [prd.md](docs/prd.md), [schema.md](docs/schema.md), and [phases.md](docs/phases.md).

**Live Production Deployment**: [https://hackmatics-grid-point.vercel.app](https://hackmatics-grid-point.vercel.app)  
**Database**: Neon Serverless Postgres (env-plumbed via `DATABASE_URL`; auth store is file-backed JSON with a Neon `users` table as the documented next step — see `backend/src/auth.py`)  
**Automated Tests**: 159 tests across 25 files (100% pass rate, `make test`)

---

## 🌟 Overview & Problem Statement

An e-commerce company serves multiple neighborhoods, each with a geographic coordinate `(latitude, longitude)` and daily demand `daily_orders` ($w_i$). Placing warehouses incorrectly results in millions of wasted delivery miles and carbon burn.

**GRIDPOINT** solves the multi-facility location and assignment problem by mathematically minimizing weighted delivery cost:

$$\min \sum_{i=1}^{N} w_i \cdot d(n_i, w_{\text{assigned}}) \cdot \text{rate}_{\text{eff}} + \sum_{k=1}^{K} \text{infra\_cost}_k$$

### The 5-Step Pipeline (Shipped, Demonstrable End-to-End)

```ini
Neighborhood Data ──► Location Visualization ──► Warehouse Optimization
                                                        │
Delivery Cost Comparison ◄── Neighborhood Assignment ◄──┘
                │
What-If Scenarios & Bonus Fleet (shipped, slider-driven)
                │
Overview Tab (SHIPPED Sept 20 2026 — Phase F: `/app/overview` + `POST /api/overview`)
```

> **Docs-vs-code status (Sept 20 2026):** `docs/phases.md` concurrent plan (**Phases A–F**, backlog #1–#14, §0) — **ALL SHIPPED** (Person 1: A onboarding trio, D per-order cost truth + elbow, E expansion policy; Person 2: B map focus + heatmap + roads fix, C traffic-aware routing, F realtime automation + Overview). Follow-up backlog #4–#9 is planned as parallel phases G–L in `docs/followup_phases.md`. Shipped spec lives in `docs/prd.md` §§5.1–5.11, `docs/schema.md` §§2.8–2.10, `docs/demo_script.md` beats.

---

## 🏗️ System Architecture

GRIDPOINT is architected as a high-performance monorepo supporting a **modern full-stack web application (React 18 + FastAPI)** powered by a shared, strictly typed Python optimization core:

```
Hackmatics_Grid_Point/
├── backend/
│   ├── src/
│   │   ├── schema.py              # Pydantic v2 data contracts (schema.md §2)
│   │   ├── validation.py          # Strict schema validation engine (§4)
│   │   ├── data_ingestion.py      # CSV/JSON parsers, alias detection & exports
│   │   ├── synthetic.py           # Seedable clustered/uniform/gaussian generator (§2.8)
│   │   ├── distance.py            # Vectorized Haversine, Euclidean & Manhattan matrices
│   │   ├── optimization.py        # Weiszfeld (K=1), Weighted K-Means (K>1), PuLP MILP CFLP (+ road-aware assignment)
│   │   ├── cost.py                # Cost engine, traffic factor, fleet weighting, live fuel & metrics
│   │   ├── mapping.py             # Geospatial bounds, bubble sizing & map layer data
│   │   ├── scenarios.py           # Phase 5: Multi-K trade-off elbow, demand shift, fleet ETA, diagnostics
│   │   ├── simulation.py          # Phase F: realtime tick (demand wave + spillover) + Overview aggregate
│   │   ├── routing.py             # Road routing provider (TomTom Matrix v2 → OSRM → Haversine fallback)
│   │   ├── traffic.py             # Live TomTom flow + corridor history (5-min TTL, JSON persistence)
│   │   ├── fuel.py                # Live India fuel prices via RapidAPI (12h TTL + static fallback)
│   │   ├── census.py              # US Census ACS demand seeder (tract populations → daily_orders)
│   │   ├── expansion.py           # Incremental warehouse expansion (add K without moving existing sites)
│   │   ├── auth.py                # JWT auth (PBKDF2 passwords, HS256 tokens, file-backed store)
│   │   ├── userdata.py            # Per-user workspace persistence (warehouses/vehicles/demand/config)
│   │   └── api.py                 # FastAPI application & REST endpoints (39 routes, § API Reference)
│   ├── tests/                     # 159 automated unit, integration & acceptance tests (25 files)
│   ├── requirements.txt           # Python dependencies (FastAPI, PuLP, scikit-learn, etc.)
│   ├── pyproject.toml             # pytest config (pythonpath=".", testpaths=["tests"])
│   └── pytest.ini
├── frontend/                      # React 18 + TypeScript + Vite + Tailwind CSS + Mapbox GL
│   ├── src/
│   │   ├── types/index.ts         # TypeScript interfaces matching schema.md
│   │   ├── services/api.ts        # REST API client (JWT, VITE_API_URL) with client-side solver fallbacks
│   │   ├── context/AuthContext.tsx # JWT session provider (login/signup/logout, /api/auth/me)
│   │   ├── data/sample.ts         # Opt-in 10-node Hyderabad sample (accounts start EMPTY, never auto-loaded)
│   │   ├── components/
│   │   │   ├── LandingPage.tsx      # Public marketing landing (/, redirects to /app/ask when logged in)
│   │   │   ├── AuthPages.tsx        # Login (/login) & signup (/signup) forms
│   │   │   ├── ProtectedRoute.tsx   # Guards /app/* — redirects to /login when logged out
│   │   │   ├── GmapsRail.tsx        # Icon rail tabs: ask/saved/optimize/compare/data/lab/overview/export/settings/help
│   │   │   ├── AskPanel.tsx         # Conversational entry point + shortcuts
│   │   │   ├── Header.tsx           # Sticky navigation
│   │   │   ├── Topbar.tsx / Sidebar.tsx / SideCards.tsx / Dashboard.tsx / SectionOverview.tsx
│   │   │   ├── SummaryCards.tsx   # Top-level demand and data health metrics
│   │   ├── FileUploader.tsx   # Drag-and-drop CSV/JSON ingestion with alias mapper (`?dataset=` trio)
│   │   │   ├── DataTable.tsx      # Editable neighborhood grid (add/delete/edit rows)
│   │   │   ├── VehicleTable.tsx / WarehouseTable.tsx # SHIPPED Phase A: fleet + existing-site CRUD + seeders
│   │   │   ├── OnboardingChecklist.tsx # SHIPPED Phase A: 0/0/0 first-run checklist
│   │   │   ├── SyntheticModal.tsx # Seedable synthetic demand pattern generator (+ Census entry point)
│   │   │   ├── CensusModal.tsx    # Real US demand via ACS tract populations (city presets)
│   │   │   ├── MapView.tsx        # Phase 2/4 Mapbox GL map: bubbles ∝ √orders, spider lines, R_max circles/isochrones
│   │   │   ├── MapChrome.tsx      # Map chips, result rows, layer flags
│   │   │   ├── OptimizationPanel.tsx # Phase 3 solver controls & assignment tables (+ road-mode re-optimize)
│   │   │   ├── OptimizationControls.tsx
│   │   │   ├── WarehouseExpansion.tsx # Add/remove warehouses + before-after slider + SHIPPED policy advisor (Phase E)
│   │   │   ├── ComparisonDashboard.tsx # Phase 4 side-by-side cost deltas, histogram, fuel graph + SHIPPED per-node truth (Phase D)
│   │   │   ├── TradeoffElbow.tsx # SHIPPED Phase D: annotated infra-vs-delivery elbow
│   │   │   ├── ScenariosPanel.tsx # Phase 5 What-If trade-offs, demand surge & fleet ETA (+ Phase F realtime tick, spillover log, collapsed manual overrides)
│   │   │   ├── OverviewTab.tsx    # SHIPPED Phase F: Overview rollup (vehicles/fuel/infra/orders/costs/alerts, deep-links)
│   │   │   ├── WarehouseFocusCard.tsx # SHIPPED Phase B: click-to-focus warehouse zone detail card
│   │   │   ├── FuelCard.tsx / TrafficCard.tsx # Live fuel & traffic surfaces
│   │   │   ├── SavedPanel.tsx / ExportView.tsx / SettingsView.tsx
│   │   │   ├── DetailCard.tsx / UsageDonut.tsx / GmapsRail.tsx
│   │   │   ├── ZoneLegendEditor.tsx
│   │   │   ├── ErrorDrawer.tsx    # Validation diagnostics drawer
│   │   │   ├── mapThemes.ts       # Mapbox styles (Standard/Light/Dark), zone colors, token helper
│   │   │   └── panelStore.ts      # Per-user localStorage, recents, CSV builders, smart defaults
│   │   └── App.tsx                # Router (/, /login, /signup, /app/:tab) + pipeline shell
│   └── package.json               # gridpoint-frontend (react, mapbox-gl, react-router-dom, vite, tailwind)
├── api/                           # Vercel serverless adapter
│   ├── index.py                   # 23-line ASGI adapter (re-exports api/src api.app; Mangum compat)
│   ├── requirements.txt           # Pinned serverless deps (fastapi, pydantic, pandas, sklearn, pulp, geopy)
│   └── src/                       # Mirror of backend/src/* (synced via `make sync-api`: cp backend/src/*.py api/src/)
├── data/samples/                  # 11 sample files: Hyderabad 20-row CSV, Bengaluru JSON, aliased/canonical,
│                                  # synthetic-3-cluster, error CSV, 1,000-node benchmark + vehicles_seed.*/warehouses_seed.* (+ data/census_cache/)
├── docs/                          # problem_statement (frozen req + backlog pointer), prd (§§5.1–5.11 ALL SHIPPED),
│                                  # schema (§2.9 Overview SHIPPED, §2.10 ExpansionRecommendation SHIPPED),
│                                  # phases (A–F ALL SHIPPED Sept 20 2026),
│                                  # demo_script (shipped beats), Phase-1 prompt (archival)
├── Makefile                       # setup, test, run-backend/frontend, build-frontend, sync-api
└── README.md
```

---

## 💻 Tech Stack

| Layer | Technology | Key Role |
| :--- | :--- | :--- |
| **Optimization Solvers** | Python 3.10+, SciPy, PuLP, scikit-learn | Weiszfeld geometric median, Weighted K-Means, MILP CFLP (+ road-aware assignment) |
| **Backend REST API** | FastAPI, Uvicorn, Pydantic v2 | Schema validation & 32 async endpoints (optimize, scenarios, fuel, traffic, census, routes, auth, expand + vehicles/warehouses validate/synthetic/export) |
| **Frontend Framework** | React 18, Vite, TypeScript, React Router 7 | Type-safe SPA with `/`, `/login`, `/signup`, `/app/:tab` routing + JWT guards |
| **Styling & UI** | Tailwind CSS, Lucide Icons | Responsive layout with clear visual hierarchy |
| **Geospatial & Maps** | Mapbox GL JS, Geopy | Interactive Mapbox map (Standard/Light/Dark), demand bubbles, spider lines, R_max circles + road isochrones |
| **Live Data Providers** | TomTom Traffic/Matrix, RapidAPI India fuel, US Census ACS | Live congestion, road distances (OSRM fallback), fuel prices (static fallback), real tract demand |
| **Auth & Storage** | JWT (PBKDF2 + HS256, 24h TTL), per-user localStorage | Login/signup, per-account namespaced datasets/configs; Neon Postgres env-plumbed (users table = next step) |
| **Automated Testing** | Pytest, Pytest-Asyncio, HTTPX | 159 tests across 25 files: unit, cost hand-calcs, routing/fuel/traffic/census/auth, onboarding, cost-truth, expansion-policy, phase-B/phase-C/simulation, acceptance + benchmarks |

---

## 🚀 Quick Start & Run Instructions

### Prerequisites
- Python 3.10+
- Node.js 18+ and `pnpm`
- `uv` (recommended) or `pip`
- A Mapbox public token (`VITE_MAPBOX_TOKEN` in `frontend/.env.local`) — required even for local dev (free tier covers it)
- Optional keys (server-side only, never commit): `RAPIDAPI_KEY` (live fuel), `TOMTOM_KEY` (live traffic + road matrix), `CENSUS_KEY` (raised Census quotas). Without them the API serves static fallbacks and reports `live=false`.

### 1. One-Step Setup
```bash
make setup
# Creates backend/.venv, installs backend/requirements.txt, runs pnpm install in frontend/
cp .env.example .env   # then fill DATABASE_URL / keys locally; never commit .env
# Frontend map token:
# echo "VITE_MAPBOX_TOKEN=pk.your_token_here" > frontend/.env.local
```

### 2. Run Full-Stack Web Application (React + FastAPI)
```bash
# Terminal 1 — FastAPI Backend (http://localhost:8000/docs)
make run-backend

# Terminal 2 — React Frontend (http://localhost:3000)
make run-frontend
```

### 3. Run Automated Test Suite
```bash
make test
# Executes all 115 unit, cost hand-calc, routing/fuel/traffic/census/auth, and acceptance tests
```

### 4. Sync the Vercel bundle (after changing backend/src/*)
```bash
make sync-api
# Copies backend/src/*.py into api/src/ so api/index.py serves the same code serverlessly
```

---

## 📐 Shipped Pipeline Features (all Phases A–F SHIPPED Sept 20 2026)

### Phase 1: Data Ingestion & Validation (SHIPPED Sept 20 2026: neighborhoods + vehicles + existing warehouses — `docs/phases.md` Phase A)
- **Multi-Format Ingestion**: Delimiter auto-sniffing (`,`, `;`, `\t`) and header alias mapping (`id` $\to$ `neighborhood_id`, `lat` $\to$ `latitude`, `lng$|`lon` $\to$ `longitude`, `orders`/`demand` $\to$ `daily_orders`).
- **Strict Validation Engine**: WGS84 coordinates check ($[-90, 90], [-180, 180]$), non-negative integer orders, unique ID validation, and interactive error drawer.
- **Editable Data Table**: Real-time inline editing, search/filter, and canonical CSV/JSON exports.
- **Seedable Synthetic Generator**: Generates `clustered`, `uniform`, or `gaussian` demand distributions with fixed seeds for benchmark reproducibility.
- **Real Demand Seeders**: US Census ACS tract populations via `CensusModal` (`GET /api/census/cities`, `GET /api/census/demand`), plus an opt-in 10-node Hyderabad sample (`frontend/src/data/sample.ts`). Every account starts EMPTY — data, configs, and zone colors are per-user namespaced in localStorage.
- **Auth-Gated Workspace**: Landing page (`/`), login/signup (`/login`, `/signup`), and `ProtectedRoute` guards for `/app/:tab` (JWT in `localStorage`, 24h TTL).
- **SHIPPED**: owned-vehicle fleet table + existing-warehouse table (`VehicleTable.tsx`, `WarehouseTable.tsx`, CRUD + validation + persistence, doubling as the "older way" baseline), deterministic synthetic seeders for both (`GET /api/synthetic/vehicles|warehouses`, `data/samples/vehicles_seed.*, warehouses_seed.*`), first-run checklist (`OnboardingChecklist.tsx`: orders → vehicles → warehouses → optimize). Daily orders live ONLY on nodes; warehouses derive `assigned_orders = Σ daily_orders` via assignment.

### Phase 2: Location Visualization & Spatial Mapping (SHIPPED Sept 20 2026: click-to-focus + heatmap + traffic overlay + roads fix — Phase B)
- **Interactive Geospatial Map**: Mapbox GL JS view (Standard/Light/Dark styles via `mapThemes.ts`; requires `VITE_MAPBOX_TOKEN`).
- **Area-Proportional Demand Bubbles**: Circle marker radius proportional to $\sqrt{w_i}$ for true visual perception of order density.
- **Controls Panel**: Live $K \in [1, 10]$ selector, distance metric toggles (Haversine, Euclidean, Manhattan, **Road**), and capacity/radius toggles (capacity, radius, live fuel + live traffic are ON by default with demand-sized $C_{\max}$).
- **Map UX**: Gmaps-style icon rail (`ask/saved/optimize/compare/data/lab/export/settings/help`), layer chips (warehouses/routes/demand/radius/traffic), displacement-vs-roads line toggle, click-to-trace driving paths, adjustable radius preview, and Mapbox isochrone service-area heatmaps in roads mode.
- **SHIPPED (Phase B)**: warehouse click-to-focus (zone detail + assigned-node table via `WarehouseFocusCard.tsx` + `POST /api/map/warehouse-focus`, dim others, highlight selected), city-wide continuous coverage zones (`POST /api/map/coverage` — padded bounds + contiguous `fill` polygons, green near → red far), corridor-traffic overlay from traced roads. **Fixed**: switching displacement→roads never surfaces raw `Pair #0…` — backend accepts `{frm|from}` spellings with straight-line fallback + friendly notice + traced/total counter.

### Phase 3: Multi-Facility Optimization Engine (SHIPPED Sept 20 2026: traffic-aware routing — Phase C)
- **$K = 1$ Weiszfeld Algorithm**: Exact weighted Fermat-Weber geometric median with numerical singularity perturbation ($\epsilon = 10^{-7}$).
- **$K > 1$ Weighted K-Means**: Demand-weighted centroid clustering with k-means++ probabilistic seeding, multi-restart inertia selection, and Weiszfeld medoid refinement.
- **Capacitated Facility Location (MILP)**: Formulated in PuLP for tight $C_{\max}$ capacity and $R_{\max}$ radius constraints.
- **Road-Optimal Mode**: `distance_metric="road"` re-optimizes and assigns on real road distances (TomTom Matrix v2 → OSRM table → Haversine fallback; 15-min cache, `MAX_ROUTE_PAIRS=60`), with parallel batch tracing and chunked progressive rendering.
- **Incremental Expansion**: `POST /api/expand` adds warehouses without moving existing sites (siting by heaviest load / $R_{\max}$ miss / farthest cost; `MAX_WAREHOUSES=10`), with a before-after map slider and apply-to-main-map.
- **SHIPPED (Phase C)**: `use_live_traffic_for_routing` toggle + `traffic_aware_reroute` (`α·cost + β·time`, `POST /api/routes/reroute` + `POST /api/traffic/corridors`) with `traffic_note`/`routing_note` provenance; corridor congestion aggregated from traced road geometries into rolling history.
- **Performance Benchmark**: Optimizes 1,000 nodes with $K=5$ in **$\sim 0.81\text{s}$** (well below the $<5.0\text{s}$ requirement).

### Phase 4: Delivery Cost Calculation & Comparative Evaluation (SHIPPED Sept 20 2026: per-order truth + elbow clarity — Phase D)
- **Comprehensive Cost Engine**:
  - Unweighted distance $\sum d_i$
  - Demand-weighted distance $\sum w_i d_i$
  - Traffic congestion modeling $d_{\text{eff}} = d \cdot (1 + \text{traffic\_factor})$ (plus live TomTom corridor congestion → `congestion_pct`)
  - Fleet-weighted cost rate + fuel surcharge (live India fuel prices auto-resolved from data center → per-node fuel costs)
  - Fixed warehouse infrastructure cost
- **Side-by-Side Comparison Dashboard**: Baseline (single centroid, or the user's OWNED existing warehouses from onboarding) vs. Optimized layout with percentage cost/distance saved, distance histogram, and a fuel-reduction graph.
- **Visual Assignment Overlays**: Colored cluster bubbles, spider vector polylines (or traced road paths) connecting customers to assigned hubs, and distance distribution histogram.
- **Verified Accuracy**: Hand-calculated cost formulas validated by automated tests in `test_cost.py`.
- **SHIPPED**: per-order road km + fuel-API costing with per-node `avg cost per order` (optimized vs older-way, node + overall via `per_order_breakdown()` + `TradeoffElbow.tsx`), guaranteed-populated `Fuel cost portion ($)` / `Avg corridor congestion` / `Feasibility ratio`, annotated infra-vs-delivery elbow with plain-language caption.

### Phase 5: Advanced Scenarios & Bonus Features (SHIPPED Sept 20 2026: realtime automation + Overview — Phase F; expansion advisor — Phase E)
- **Multi-K Infrastructure vs. Delivery Cost Trade-off (Elbow Analysis)**:
  - Interactive slider for fixed facility infrastructure cost ($\$0 - \$3,000/\text{hub}$).
  - Evaluates $K = 1 \dots 8$ simultaneously to plot Delivery Cost vs. Infrastructure Cost vs. Combined Total Cost.
  - Automatically identifies and recommends the mathematically optimal $K$ (sweet spot).
- **Customer Demand Surge & Contraction Simulator**:
  - Slider $\Delta\% \in [-50\%, +100\%]$ with quick-select presets (Slump, Baseline, Festive Surge, 2x Peak).
  - One-click "Apply & Re-optimize" dynamically shifts customer volumes and repositions warehouses.
- **Rush-Hour Traffic & Vehicle Fleet Delivery ETA Calculator**:
  - Traffic congestion slider ($0\% - 100\%$ delay factor).
  - Vehicle fleet selection: Cargo E-Bike ($25\text{ km/h}, 30\text{ orders}$), Delivery Van ($40\text{ km/h}, 120\text{ orders}$), Heavy Truck ($30\text{ km/h}, 500\text{ orders}$).
  - Real-time calculations of average and maximum drop ETA in minutes, total batch trips dispatched, and fuel liters consumed.
- **Constraint Compliance & Diagnostics Center**:
  - Real-time warehouse utilization gauges with progressive color thresholds (Normal, High, Overflow).
  - Violation audit listing exact distance overages for any nodes outside the $R_{\max}$ radius limit.
- **SHIPPED (Phase E)**: keep-vs-abandon/demolish + keep-vs-sell expansion policy with revenue-aware `ExpansionRecommendation` (`POST /api/expand {policy, owned_vehicles}`, `WarehouseExpansion.tsx`).
- **SHIPPED (Phase F)**: `simulation_mode=realtime` loop — live fuel/traffic/demand tick drives Fleet ETA + demand surge (sliders survive as collapsed offline overrides), congestion spillover reassignment with threshold + hysteresis + cooldown and an event log (`POST /api/simulation/tick`, `POST /api/simulation/live`), and the **Overview tab** (`/app/overview`, `POST /api/overview`: vehicles, fuel + provenance, infra, warehouses, orders, costs, alerts — each figure linked to source).

### All Phases A–F SHIPPED (`docs/phases.md`)
A Onboarding Trio ✅ · B Map UX ✅ · C Traffic-aware routing ✅ · D Cost truth ✅ · E Expansion advisor ✅ · F Realtime automation + Overview ✅. Minimal-overlap concurrency map + frozen §1 interfaces + traceability in `docs/phases.md`.

---

## 🏆 Bonus Features Summary (8 / 8 Implemented)

| # | Bonus Requirement (Problem Statement) | Implementation & Location |
| :-: | :--- | :--- |
| **1** | Support multiple warehouses | Weighted K-Means with Weiszfeld refinement & PuLP MILP solver (`backend/src/optimization.py`) + incremental expansion (`backend/src/expansion.py`, `WarehouseExpansion.tsx`) |
| **2** | Limited warehouse capacity ($C_{\max}$) | PuLP CFLP formulation + UI capacity utilization gauges & overflow alerts (`backend/src/scenarios.py`); capacity ON by default |
| **3** | Maximum delivery radius ($R_{\max}$) | Vectorized radius filtering + map radius circles/isochrone heatmap + violation audit list (`backend/src/mapping.py`, `backend/src/scenarios.py`) |
| **4** | Different vehicle types | Multi-class fleet specifications (`VehicleType`: E-Bike, Van, Truck) with custom speeds, capacities & mileage (`backend/src/schema.py`, `ScenariosPanel.tsx`) |
| **5** | Include fuel costs | Live India fuel prices (`backend/src/fuel.py`, `GET /api/fuel/rates`) + per-node fuel costs and fuel-reduction graph (`backend/src/cost.py`, `ComparisonDashboard.tsx`) |
| **6** | Traffic-dependent delivery times | Live TomTom flow + corridor history (`backend/src/traffic.py`, `GET /api/traffic/flow`) and congestion multiplier $d \cdot (1 + \text{traffic}) / v \times 60$ for live drop ETAs (`backend/src/scenarios.py`) |
| **7** | Model changes in customer demand | Interactive demand shift simulator with preset chips ($-50\%$ to $+100\%$) and live re-optimization (`POST /api/scenarios/demand-shift`) |
| **8** | Infrastructure vs. delivery cost trade-off | Interactive multi-$K$ Elbow Analysis curve finding cost-minimizing $K$ (`POST /api/scenarios/tradeoff`, `ScenariosPanel.tsx`) |

Beyond the 8 bonuses, the repo also ships: real road-network optimization (`distance_metric="road"`, `POST /api/routes/geometry` — accepts `{frm|from}` spellings with friendly fallback), traffic-aware routing (`use_live_traffic_for_routing`, `POST /api/routes/reroute`, `POST /api/traffic/corridors`), realtime simulation (`POST /api/simulation/tick|live`) + Overview tab (`POST /api/overview`, `/app/overview`), US Census demand seeding (`GET /api/census/*`, `CensusModal.tsx`), JWT auth + per-account workspaces (`POST|GET /api/auth/*`), and Ask/Saved/Export/Settings panels.

---

## 🔌 API Reference (FastAPI, `backend/src/api.py` → served at `/api/*`)

| Method | Path | Description |
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
| POST | `/api/routes/reroute` | `traffic_aware_reroute` (`α·cost + β·time`) with changed-assignments + saved minutes/₹ (Phase C) |
| POST | `/api/routes/geometry` | Traced road polylines for assignment pairs (TomTom → OSRM → fallback). Accepts `{frm|from}` spellings (Phase B fix); failures fall back to straight lines with a friendly notice. |
| POST | `/api/scenarios/tradeoff` | Multi-K infra-vs-delivery elbow curve |
| POST | `/api/scenarios/demand-shift` | Scale $w_i$ by $\Delta\%$ and re-evaluate |
| POST | `/api/scenarios/eta` | Fleet + traffic ETA (avg/max minutes, trips, fuel liters) |
| POST | `/api/scenarios/diagnostics` | Capacity utilization + $R_{\max}$ violation audit |
| POST | `/api/simulation/tick` | Realtime tick: demand wave + congestion spillover (stateless via `active_spills`) |
| POST | `/api/simulation/live` | Live fuel + corridor traffic + demand snapshot for one tick |
| POST | `/api/overview` | Overview aggregate (vehicles/fuel/infra/orders/costs/alerts) |
| POST | `/api/auth/signup` / `/api/auth/login` | PBKDF2 signup + HS256 login (24h TTL) |
| GET | `/api/auth/me` | Current user from `Authorization: Bearer <token>` |
| GET / PUT | `/api/user/data` | Per-user workspace (warehouses/vehicles/demand/config) persisted across sessions (JWT required) |

The frontend (`frontend/src/services/api.ts`) uses `VITE_API_URL || '/api'` and ships offline fallbacks (`localValidate`, `localOptimizeNetwork`, synthetic/CSV builders) so the UI still works without the backend. After editing `backend/src/*`, run `make sync-api` so Vercel's `api/src/` mirror stays in sync.

---

## 🤖 AI Tools & Development Disclosure

In accordance with Hack-A-Matics transparency guidelines:
- **Code Assistants**: Antigravity agentic coding assistant was utilized for scaffolding boilerplate, structuring test suites, and accelerating mathematical vectorization.
- **Core Algorithms**: Vectorized Haversine distance matrices, Weiszfeld iteration formulas, and PuLP MILP constraints were engineered to strictly conform to `docs/schema.md` and `docs/prd.md`.
- **Validation**: All optimization logic and cost formulas were rigorously verified using 159 automated test cases (including hand-calculated ground truth, routing/fuel/traffic/census/auth, onboarding trio, cost-truth, expansion-policy, phase-B/phase-C/simulation, and acceptance benchmarks).

---

## 👥 Authors & License

Built for **HACK-A-MATICS 2026** by the GRIDPOINT Team. Open source under the MIT License.
