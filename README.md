# GRIDPOINT — Where Should the Warehouse Go?

> **Warehouse Location & Assignment Optimization Platform**  
> Built for the **HACK-A-MATICS** Hackathon.  
> Aligned to [problem_statement.md](docs/problem_statement.md), [prd.md](docs/prd.md), [schema.md](docs/schema.md), and [phases.md](docs/phases.md).

**Live Production Deployment**: [https://hackmatics-grid-point.vercel.app](https://hackmatics-grid-point.vercel.app)  
**Database**: Neon Serverless Postgres (`gridpoint` on `aws-ap-southeast-1`)

---

## 🌟 Overview & Pipeline

An e-commerce company serves multiple neighborhoods, each with a geographic coordinate `(latitude, longitude)` and demand volume `daily_orders`. **GRIDPOINT** optimizes warehouse placement and neighborhood assignments to minimize weighted delivery costs:

$$\min \sum_{i} w_i \cdot d(n_i, w_{\text{assigned}})$$

### Complete 5-Step Pipeline
```ini
Neighborhood Data (Phase 1) ──► Location Visualization (Phase 2) ──► Warehouse Optimization (Phase 3)
                                                                               │
Delivery Cost Comparison (Phase 4) ◄── Neighborhood Assignment (Phase 3) ◄─────┘
```

---

## 🏗️ Monorepo Architecture

This project is structured as a high-performance monorepo supporting both a **modern full-stack web application (React + FastAPI)** and an **alternative Streamlit single-command dashboard**, both sharing the identical Python domain core:

```
Hackmatics_Grid_Point/
├── backend/
│   ├── src/
│   │   ├── __init__.py
│   │   ├── schema.py              # Pydantic v2 data contracts (schema.md)
│   │   ├── validation.py          # Strict schema validation engine (§4)
│   │   ├── data_ingestion.py      # CSV/JSON parsers, alias detection & exports
│   │   ├── synthetic.py           # Seedable clustered/uniform/gaussian generator (§2.8)
│   │   └── api.py                 # FastAPI REST application
│   ├── tests/
│   │   ├── test_schema.py         # Schema model tests
│   │   ├── test_validation.py     # Out-of-range, null, duplicate & constraint tests
│   │   ├── test_data_ingestion.py # Parser, alias normalization & export tests
│   │   ├── test_synthetic.py      # Synthetic generator & seed reproducibility tests
│   │   ├── test_api.py            # FastAPI endpoints test
│   │   └── test_acceptance_phase1.py # Phase 1 acceptance & 1000-node performance tests
│   ├── app.py                     # Streamlit application UI
│   ├── requirements.txt           # Python dependencies
│   ├── pyproject.toml             # Pytest & package settings
│   └── pytest.ini
├── frontend/                      # React 18 + TypeScript + Vite + Tailwind CSS
│   ├── src/
│   │   ├── types/index.ts         # TypeScript data contracts
│   │   ├── services/api.ts        # API client & offline validation fallback
│   │   ├── components/
│   │   │   ├── Header.tsx         # Navbar with phase status tracking
│   │   │   ├── SummaryCards.tsx   # Demand and validation metric cards
│   │   │   ├── FileUploader.tsx   # Drag-and-drop CSV/JSON with auto-mapping
│   │   │   ├── DataTable.tsx      # Tabular editor (add/edit/delete, pagination)
│   │   │   ├── SyntheticModal.tsx # Seedable synthetic generator modal
│   │   │   └── ErrorDrawer.tsx    # Diagnostics error drawer
│   │   ├── App.tsx
│   │   └── main.tsx
│   ├── package.json
│   ├── vite.config.ts
│   └── tailwind.config.js
├── data/
│   └── samples/
│       ├── hyderabad_demand.csv    # 20 canonical Hyderabad neighborhoods
│       ├── neighborhoods_sample.json # Sample JSON dataset
│       ├── sample_with_errors.csv  # Intentionally invalid rows for error testing
│       └── large_1000_nodes.csv    # 1,000 synthetic nodes performance benchmark
├── docs/                           # Problem statement, PRD, schemas, sprint phases
├── app.py                         # Root Streamlit entry point
├── requirements.txt               # Root Python requirements
├── package.json                   # Monorepo scripts
├── Makefile                       # One-command developer targets
└── README.md
```

---

## 💻 Tech Stack

| Layer | Technology | Purpose |
| :--- | :--- | :--- |
| **Language** | Python 3.10+ / TypeScript | Core algorithms & type safety |
| **Backend API** | FastAPI, Uvicorn, Pydantic v2 | High-speed async REST endpoints |
| **Frontend UI** | React 18, Vite, Tailwind CSS, Lucide | Interactive, responsive dashboard |
| **Alternative UI** | Streamlit 1.32+ | Single-command Python UI option |
| **Data & Science** | Pandas, NumPy, SciPy | Ingestion, dataframes, spatial arrays |
| **Optimization** | scikit-learn, SciPy/Weiszfeld, PuLP | K-Means, geometric median & MILP solver |
| **Geospatial** | Geopy, WGS84 coordinates | Haversine distance computations |
| **Testing** | Pytest, Pytest-Asyncio, HTTPX | 31 automated tests, 100% Phase 1 pass rate |

---

## 🚀 Quick Start & Run Instructions

### Prerequisites
- Python 3.10+
- Node.js 18+ and `pnpm` (or `npm`)
- `uv` (recommended for instant Python package installation) or `pip`

### 1. One-Step Setup
Using `make`:
```bash
make setup
```

Or manually:
```bash
# Python backend
uv venv backend/.venv
uv pip install -r backend/requirements.txt --python backend/.venv/bin/python

# Frontend
cd frontend && pnpm install
```

---

### 2. Running the Full-Stack Application (React + FastAPI)

Start the backend (Terminal 1):
```bash
make run-backend
# Or: backend/.venv/bin/uvicorn src.api:app --reload --port 8000 --app-dir backend
```
> Backend API and Swagger docs will be live at: `http://localhost:8000/docs`

Start the frontend (Terminal 2):
```bash
make run-frontend
# Or: pnpm --prefix frontend dev
```
> Access the React application at: `http://localhost:3000`

---

### 3. Running the Single-Command Streamlit Dashboard

If you prefer the single-command Streamlit application:
```bash
make run-streamlit
# Or: backend/.venv/bin/streamlit run app.py
```
> Access the Streamlit application at: `http://localhost:8501`

---

### 4. Running the Automated Test Suite

Run all 31 unit, integration, and Phase 1 acceptance tests:
```bash
make test
# Or: backend/.venv/bin/pytest -c backend/pyproject.toml backend/tests -v
```

---

## 🎯 Phase 1 Completed Features

- [x] **Monorepo Architecture**: Clean separation between `backend/`, `frontend/`, `data/samples/`, and root runners.
- [x] **CSV & JSON Ingestion Layer**:
  - Auto-detection of delimiters (`,` `;` `\t`) and header alias mapping (`id` $\rightarrow$ `neighborhood_id`, `lat` $\rightarrow$ `latitude`, `orders`/`demand` $\rightarrow$ `daily_orders`).
  - Accepts both JSON arrays `[...]` and wrapped objects `{"neighborhoods": [...]}`.
- [x] **Validation Engine (`src/validation.py`)**:
  - WGS84 range validation: `latitude ∈ [-90, 90]`, `longitude ∈ [-180, 180]`.
  - Volume validation: `daily_orders ≥ 0` integer.
  - Non-empty, non-null, and duplicate `neighborhood_id` detection.
  - Detailed error diagnostics drawer with row number, field name, value, error description, and code (`OUT_OF_RANGE`, `DUPLICATE_ID`, `NULL_OR_EMPTY`).
- [x] **Interactive Tabular Data Editor**:
  - Add new rows with auto-incremented IDs.
  - Delete records interactively.
  - Real-time cell editing with search/filter and pagination (handles 1,000+ nodes).
- [x] **Seedable Synthetic Data Generator (`src/synthetic.py`)**:
  - Generates realistic geographic demand points with `clustered`, `uniform`, or `gaussian` spatial distributions.
  - Seedable for deterministic reproducibility across simulation runs.
- [x] **Export Capabilities**: Export active datasets to canonical CSV and JSON.
- [x] **Performance & Acceptance**:
  - Parses and validates 1,000 nodes in under **0.2 seconds** (far exceeding the <5s requirement).
  - 31 passing automated tests.

---

## 🗺️ Phase 2 Completed Features: Location Visualization & Spatial Mapping

- [x] **Interactive Geospatial Demand Map**:
  - **React (Leaflet)**: Real-time map rendering with OpenStreetMap, CartoDB Positron (Light), and Dark Matter tiles.
  - **Streamlit (PyDeck)**: Auto-centered ScatterplotLayer rendering demand nodes with hover tooltips.
- [x] **Cartographic Demand Bubbles**:
  - Circle marker radius proportional to $\sqrt{w_i}$ (area-proportional to order volume for proper human perception).
  - Demand intensity color palette: Low (Emerald), Medium (Amber), High (Rose/Crimson).
  - Interactive tooltips & popups showing ID, name, coordinates, and exact order count.
- [x] **Optimization Controls & Parameter Selection**:
  - **Warehouse Count $K$**: Slider & quick-select presets for $K \in [1, 10]$.
  - **Distance Metric**: Selection between **Haversine** (spherical great-circle), **Euclidean** (flat plane), and **Manhattan** ($L_1$ grid) with contextual descriptions.
  - **Constraints Configuration**: Toggles and inputs for $C_{max}$ (capacity), $R_{max}$ (radius), delivery cost rate ($\$/\text{km}$), and traffic multiplier.
- [x] **Spatial Bounds & Edge-Case Guards**:
  - Automatic viewport bounding box calculation with padding.
  - Safeguards for single-point datasets and empty sets.
- [x] **Automated Tests & Performance**:
  - 38 passing backend tests (all unit + Phase 1 & Phase 2 acceptance tests).
  - 1,000 nodes spatial styling and bounds calculation takes $<0.05$s (far exceeding the <2.0s requirement).

