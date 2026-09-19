# GRIDPOINT — Where Should the Warehouse Go?

> **Warehouse Location & Assignment Optimization Platform**  
> Built for the **HACK-A-MATICS** Hackathon.  
> Aligned to [problem_statement.md](docs/problem_statement.md), [prd.md](docs/prd.md), [schema.md](docs/schema.md), and [phases.md](docs/phases.md).

**Live Production Deployment**: [https://hackmatics-grid-point.vercel.app](https://hackmatics-grid-point.vercel.app)  
**Database**: Neon Serverless Postgres (`gridpoint` on `aws-ap-southeast-1`)  
**Automated Tests**: 64 tests passing in ~2.4s (100% pass rate)

---

## 🌟 Overview & Problem Statement

An e-commerce company serves multiple neighborhoods, each with a geographic coordinate `(latitude, longitude)` and daily demand `daily_orders` ($w_i$). Placing warehouses incorrectly results in millions of wasted delivery miles and carbon burn.

**GRIDPOINT** solves the multi-facility location and assignment problem by mathematically minimizing weighted delivery cost:

$$\min \sum_{i=1}^{N} w_i \cdot d(n_i, w_{\text{assigned}}) \cdot \text{rate}_{\text{eff}} + \sum_{k=1}^{K} \text{infra\_cost}_k$$

### The 5-Step Pipeline (Demonstrable End-to-End)

```ini
Neighborhood Data (Phase 1) ──► Location Visualization (Phase 2) ──► Warehouse Optimization (Phase 3)
                                                                               │
Delivery Cost Comparison (Phase 4) ◄── Neighborhood Assignment (Phase 3) ◄─────┘
               │
What-If Scenarios & Bonus Fleet (Phase 5)
```

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
│   │   ├── optimization.py        # Weiszfeld (K=1), Weighted K-Means (K>1), PuLP MILP CFLP
│   │   ├── cost.py                # Cost engine, traffic factor, fleet weighting & metrics
│   │   ├── mapping.py             # Geospatial bounds, bubble sizing & GeoJSON exports
│   │   ├── scenarios.py           # Phase 5: Multi-K trade-off elbow, demand shift, fleet ETA
│   │   └── api.py                 # FastAPI application & REST endpoints
│   ├── tests/                     # 64 automated unit, integration & acceptance tests
│   ├── requirements.txt           # Python dependencies (FastAPI, PuLP, scikit-learn, etc.)
│   └── pytest.ini
├── frontend/                      # React 18 + TypeScript + Vite + Tailwind CSS
│   ├── src/
│   │   ├── types/index.ts         # TypeScript interfaces matching schema.md
│   │   ├── services/api.ts        # REST API client with full client-side solver fallbacks
│   │   ├── components/
│   │   │   ├── Header.tsx         # Sticky navigation with 5 active pipeline stages
│   │   │   ├── SummaryCards.tsx   # Top-level demand and data health metrics
│   │   │   ├── FileUploader.tsx   # Drag-and-drop CSV/JSON ingestion with alias mapper
│   │   │   ├── DataTable.tsx      # Editable neighborhood grid (add/delete/edit rows)
│   │   │   ├── SyntheticModal.tsx # Seedable synthetic demand pattern generator
│   │   │   ├── MapVisualizer.tsx  # Phase 2 Leaflet map with bubble diameter ∝ √orders
│   │   │   ├── OptimizationPanel.tsx # Phase 3 solver controls & assignment tables
│   │   │   ├── MapView.tsx        # Phase 4 spider lines & warehouse cluster map
│   │   │   ├── ComparisonDashboard.tsx # Phase 4 side-by-side cost deltas & histogram
│   │   │   ├── ScenariosPanel.tsx # Phase 5 What-If trade-offs, demand surge & fleet ETA
│   │   │   └── ErrorDrawer.tsx    # Validation diagnostics drawer
│   │   └── App.tsx                # Master pipeline shell
│   └── package.json
├── api/                           # Vercel serverless Python adapter & bundle sync
├── data/samples/                  # Hyderabad canonical CSV/JSON & 1,000-node benchmarks
├── docs/                          # PRD, Problem statement, Schema specs, Demo script
├── Makefile                       # One-command developer build & test targets
└── README.md
```

---

## 💻 Tech Stack

| Layer | Technology | Key Role |
| :--- | :--- | :--- |
| **Optimization Solvers** | Python 3.10+, SciPy, PuLP, scikit-learn | Weiszfeld geometric median, Weighted K-Means, MILP CFLP |
| **Backend REST API** | FastAPI, Uvicorn, Pydantic v2 | Sub-millisecond schema validation & async endpoints |
| **Frontend Framework** | React 18, Vite, TypeScript | Type-safe, reactive single-page application |
| **Styling & UI** | Tailwind CSS, Lucide Icons | Responsive layout with clear visual hierarchy |
| **Geospatial & Maps** | Leaflet, React-Leaflet, Geopy | Interactive OSM map, custom bubble markers, spider lines |
| **Database** | Neon Serverless Postgres | Cloud persistence for demand points and optimization runs |
| **Automated Testing** | Pytest, Pytest-Asyncio, HTTPX | 64 test cases covering unit, cost formulas, and benchmarks |

---

## 🚀 Quick Start & Run Instructions

### Prerequisites
- Python 3.10+
- Node.js 18+ and `pnpm`
- `uv` (recommended) or `pip`

### 1. One-Step Setup
```bash
make setup
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
# Executes all 64 unit, cost hand-calc, and acceptance tests in ~2.4s
```

---

## 📐 Completed Pipeline Features

### Phase 1: Data Ingestion & Validation
- **Multi-Format Ingestion**: Delimiter auto-sniffing (`,`, `;`, `\t`) and header alias mapping (`id` $\to$ `neighborhood_id`, `lat` $\to$ `latitude`, `orders`/`demand` $\to$ `daily_orders`).
- **Strict Validation Engine**: WGS84 coordinates check ($[-90, 90], [-180, 180]$), non-negative integer orders, unique ID validation, and interactive error drawer.
- **Editable Data Table**: Real-time inline editing, search/filter, and canonical CSV/JSON exports.
- **Seedable Synthetic Generator**: Generates `clustered`, `uniform`, or `gaussian` demand distributions with fixed seeds for benchmark reproducibility.

### Phase 2: Location Visualization & Spatial Mapping
- **Interactive Geospatial Map**: Leaflet OpenStreetMap view with custom tile styles.
- **Area-Proportional Demand Bubbles**: Circle marker radius proportional to $\sqrt{w_i}$ for true visual perception of order density.
- **Controls Panel**: Live $K \in [1, 10]$ selector, distance metric toggles (Haversine, Euclidean, Manhattan), and capacity/radius toggles.

### Phase 3: Multi-Facility Optimization Engine
- **$K = 1$ Weiszfeld Algorithm**: Exact weighted Fermat-Weber geometric median with numerical singularity perturbation ($\epsilon = 10^{-7}$).
- **$K > 1$ Weighted K-Means**: Demand-weighted centroid clustering with k-means++ probabilistic seeding, multi-restart inertia selection, and Weiszfeld medoid refinement.
- **Capacitated Facility Location (MILP)**: Formulated in PuLP for tight $C_{\max}$ capacity and $R_{\max}$ radius constraints.
- **Performance Benchmark**: Optimizes 1,000 nodes with $K=5$ in **$\sim 0.81\text{s}$** (well below the $<5.0\text{s}$ requirement).

### Phase 4: Delivery Cost Calculation & Comparative Evaluation
- **Comprehensive Cost Engine**:
  - Unweighted distance $\sum d_i$
  - Demand-weighted distance $\sum w_i d_i$
  - Traffic congestion modeling $d_{\text{eff}} = d \cdot (1 + \text{traffic\_factor})$
  - Fleet-weighted cost rate + fuel surcharge
  - Fixed warehouse infrastructure cost
- **Side-by-Side Comparison Dashboard**: Baseline (single centroid) vs. Optimized layout with percentage cost/distance saved.
- **Visual Assignment Overlays**: Colored cluster bubbles, spider vector polylines connecting customers to assigned hubs, and distance distribution histogram.
- **Verified Accuracy**: Hand-calculated cost formulas validated by automated tests in `test_cost.py`.

### Phase 5: Advanced Scenarios & Bonus Features
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

---

## 🏆 Bonus Features Summary (8 / 8 Implemented)

| # | Bonus Requirement (Problem Statement) | Implementation & Location |
| :-: | :--- | :--- |
| **1** | Support multiple warehouses | Weighted K-Means with Weiszfeld refinement & PuLP MILP solver (`src/optimization.py`) |
| **2** | Limited warehouse capacity ($C_{\max}$) | PuLP CFLP formulation + UI capacity utilization gauges & overflow alerts (`src/scenarios.py`) |
| **3** | Maximum delivery radius ($R_{\max}$) | Vectorized radius filtering + map radius circles + violation audit list (`src/mapping.py`, `src/scenarios.py`) |
| **4** | Different vehicle types | Multi-class fleet specifications (`VehicleType`: E-Bike, Van, Truck) with custom speeds & capacities |
| **5** | Include fuel costs | Surcharge per km parameter + total fuel consumption in liters calculation (`src/cost.py`, `src/scenarios.py`) |
| **6** | Traffic-dependent delivery times | Congestion multiplier $d \cdot (1 + \text{traffic}) / v \times 60$ calculating live drop ETAs (`src/scenarios.py`) |
| **7** | Model changes in customer demand | Interactive demand shift simulator with preset chips ($-50\%$ to $+100\%$) and live re-optimization |
| **8** | Infrastructure vs. delivery cost trade-off | Interactive multi-$K$ Elbow Analysis curve finding cost-minimizing $K$ (`src/scenarios.py`, `ScenariosPanel.tsx`) |

---

## 🤖 AI Tools & Development Disclosure

In accordance with Hack-A-Matics transparency guidelines:
- **Code Assistants**: Antigravity agentic coding assistant was utilized for scaffolding boilerplate, structuring test suites, and accelerating mathematical vectorization.
- **Core Algorithms**: Vectorized Haversine distance matrices, Weiszfeld iteration formulas, and PuLP MILP constraints were engineered to strictly conform to `docs/schema.md` and `docs/prd.md`.
- **Validation**: All optimization logic and cost formulas were rigorously verified using 64 automated test cases with hand-calculated ground truth benchmarks.

---

## 👥 Authors & License

Built for **HACK-A-MATICS 2026** by the GRIDPOINT Team. Open source under the MIT License.
