# Follow-up Phases G–L — User Backlog Features 4–9 (Parallel Plan)

> Source: user 9-item backlog (Sept 2026), items #1–#3 shipped as a hotfix batch
> (Fun-Fact/Insight removal, city-wide continuous heatmap, file-backed login).
> This doc covers items **#4–#9** as six parallel-safe phases **G–L**.
> Pre-read: `docs/phases.md` (A–F conventions), `docs/schema.md` (field names),
> `AGENTS.md` (commands, `make sync-api` rule).

## §0. Backlog mapping (verbatim feature requests → phase)

| # | Request | Phase | Owner files (exclusive) |
|---|---------|-------|-------------------------|
| 4 | Seed data generation + visualize seeded entities (warehouses, vehicles, nodes, orders) | **G** seed-viz | `SyntheticModal`, `CensusModal`, NEW `SeedResultsPanel`; `synthetic.py`/`census.py` additions |
| 5 | Bookmark/save warehouses + vehicles, quick access | **H** bookmarks | `SavedPanel`, `WarehouseTable`, `VehicleTable`, panelStore NEW keys only |
| 6 | Functional realtime simulation: order movement, dynamic capacity, fuel+traffic in sim, live map | **I** sim-live | `simulation.py`, NEW `SimulationLive`, MapView live-markers (additive), ScenariosPanel tick region |
| 7 | Fix search + category dropdown (trucks, cars, warehouses, nodes, orders) | **J** search | App search-bar block, NEW `searchIndex.ts` |
| 8 | Auto-activate radius on warehouse select | **K** auto-radius | `handleWarehouseClick` + radius logic, MapView radius-focus block |
| 9 | Dynamic zone traffic: centre-high → edge-low, red/yellow/green, realtime, affects routes/ETA/fuel | **L** zone-traffic | `traffic.py`, NEW `GET /api/traffic/zones`, corridor buckets, MapView traffic overlay, `TrafficCard` |

## §1. Shared frozen contracts (do not change without updating all phases)

### 1.1 Search result (J produces, App consumes — existing callbacks reused)
```ts
interface SearchHit { kind: 'node'|'warehouse'|'vehicle'|'order';
  id: string; label: string; sub: string; refId: string }
// J wires hits into existing onOpenDetail(node) / onShowResults(nodes,title).
// Vehicles/orders without map coords open DetailCard-style rows via onShowResults.
```

### 1.2 Bookmark record (H produces, SavedPanel reads)
```ts
interface Bookmark { kind: 'warehouse'|'vehicle'; id: string; savedAt: number }
// panelStore: NEW functions getBookmarks()/toggleBookmark()/isBookmarked() +
// NEW keys gridpoint_bookmarks_<uid>. Append-only: NO edits to existing fns.
```

### 1.3 Traffic zones (L produces, I consumes, map renders)
```
GET /api/traffic/zones → { zones: [{ zone_id, name, intensity: 0..1,
  level: 'low'|'medium'|'high', polygon: [[lon,lat]...] }], live: bool }
colors: high #ef4444 · medium #f59e0b · low #22c55e (matches corridor scale)
helper: traffic.zone_factor(lat, lon) -> float  // I imports this; falls back
  // to corridor/manual floor when zones unavailable (I must work if L is late)
```

### 1.4 Tick payload additions (I extends, additive-only)
```
POST /api/simulation/tick += { order_moves: [{order_id, from_warehouse, to_warehouse}],
  capacity_updates: {W1: {assigned_orders, utilization_pct}}, fuel_snapshot, zone_intensities }
```

### 1.5 App.tsx region ownership (exclusive line-regions per phase)
| Phase | Region | Approx lines |
|-------|--------|--------------|
| J | `submitSearch` + search-bar JSX | ~542–568, ~1000–1030 |
| K | `handleWarehouseClick` + `effectiveRadiusKm` | ~637–650 |
| G | data-tab props into `<SeedResultsPanel/>` (one insertion) | data tab |
| H, I, L | NO App.tsx edits (H: tables internal; I: via ScenariosPanel props; L: via MapView props) |

### 1.6 MapView prop additions (all optional/additive — no signature breaks)
`liveMoves?: OrderMove[]; showLive?: boolean` (I) · traffic handled via
existing `colorRoutesByTraffic` + new `trafficZones?: Zone[]` (L) · radius via
existing `showRadius`/`focusedWarehouseId` (K reads only).

## §2. Phase specs

### Phase G — Seed generation + results visualization (#4)
**Goal**: seeding shows what it created; seeded warehouses/vehicles/nodes/orders
are browsable in-app.
**Owns**: `SyntheticModal.tsx`, `CensusModal.tsx`, NEW `SeedResultsPanel.tsx`
(counts + per-entity tables + "load into workspace" + "view on map"),
`backend/src/synthetic.py` + `census.py` (additive: return counts/summary),
`services/api.ts` seed wrappers (append-only).
**Reads**: `DataTable.tsx`, `VehicleTable.tsx`, `WarehouseTable.tsx` (reuse row UI).
**Acceptance**: seeding any source opens results with exact counts;
warehouses/vehicles/nodes/orders each listed and clickable to map/detail.

### Phase H — Entity bookmarks (#5)
**Goal**: star any warehouse/vehicle; revisit from Saved in one tap.
**Owns**: `SavedPanel.tsx` (new Bookmarks section), `WarehouseTable.tsx` +
`VehicleTable.tsx` (star toggle column, self-contained via panelStore),
panelStore NEW bookmark keys/functions only.
**Acceptance**: toggle persists per account; Saved lists bookmarks grouped by
kind; tapping one opens its detail/map focus; empty state guides user.

### Phase I — Realtime simulation dynamics (#6)
**Goal**: ticks visibly move orders, capacity bars breathe, fuel/traffic feed in.
**Owns**: `backend/src/simulation.py` (§1.4 payload), NEW `SimulationLive.tsx`
(live order-move feed + capacity meters), ScenariosPanel tick region (~78–160),
MapView live-move markers (additive props only).
**Consumes**: L's `zone_factor` with graceful fallback (works standalone).
**Acceptance**: with realtime on, ticks animate moves on map, warehouse
utilization updates without re-optimize, fuel/traffic snapshot shown per tick.

### Phase J — Unified category search (#7)
**Goal**: working search bar + category dropdown across nodes, warehouses,
vehicles (trucks/cars via fleet type), orders.
**Owns**: App search block (§1.5), NEW `searchIndex.ts` (token index over all
kinds), category dropdown UI. Reuses `ResultRows`/detail callbacks.
**Acceptance**: each category returns correct hits; empty query shows hint;
selecting a hit opens detail or map focus; no dead search states.

### Phase K — Auto warehouse radius (#8)
**Goal**: selecting a warehouse auto-enables + isolates its radius; deselect
restores the previous layer flag (no manual unclick/reclick).
**Owns**: `handleWarehouseClick` + radius enable logic, MapView radius-focus
block (~489+). Saves prior `layers.radius` and restores on clear-focus.
**Acceptance**: click warehouse → radius on + others dim; click again/Esc →
previous layer state restored; manual radius toggle still works untouched.

### Phase L — Dynamic zone traffic (#9)
**Goal**: city split into zones (centre high → outer low), red/yellow/green,
refreshing in realtime and feeding routes, ETA, fuel.
**Owns**: `backend/src/traffic.py` (zone model: radial falloff from demand
centroid + jitter + time wave), `GET /api/traffic/zones`, corridor bucket
extension in `mapping.py`, MapView zone overlay, `TrafficCard` legend.
**Exposes**: §1.3 contract for Phase I. Routing/ETA/fuel read zone factors
through existing `corridor_factor` path (extend, don't fork).
**Acceptance**: zones render with correct colors, intensities shift across
ticks, reroute/ETA/fuel reflect congestion, `live=false` fallback when offline.

## §3. Parallel execution rules
1. One short-lived branch per phase: `phase/G-seed-viz`, `phase/H-bookmarks`,
   `phase/I-sim-live`, `phase/J-search`, `phase/K-auto-radius`, `phase/L-zone-traffic`.
2. Merge order: any (I works without L via fallback; L exposes contract first
   if both land same day, I rebases to consume it).
3. No phase edits another phase's owned files (§0) or App regions (§1.5).
   Shared files are additive-only: new props optional, new store keys only,
   new endpoints only — never change existing signatures.
4. After any `backend/src` change: `make sync-api`. Green gate per merge:
   `make test` (add pytest for new logic) + `pnpm --prefix frontend build`.
5. Traceability: update `docs/schema.md` §6 + `docs/prd.md` §5 surgical lines
   for new endpoints/contracts; keep `problem_statement.md` frozen.

## Appendix A — Hotfix batch (shipped, precedes G–L)
- #1 Road-error notice ("Pair #0…" div): removed the `routeNotice` pill from the
  map UI; road failures now fall back to straight lines silently, and
  `friendlyRouteError` swallows any validator-style text as defense in depth.
- #2 Heatmap: padded city-wide bounds + `bounds`/`cell_step` + `fill` zones.
- #3 Login: file-backed user store (`GRIDPOINT_USERS_FILE`).
