# Parallel Tracks

| Sprint | **Person 1 — Data + Cost + Expansion** | **Person 2 — Map + Routing + Realtime** |
|---|---|---|
| **Sprint 1** | **Phase A — #4, #6, #8**<br>• `schema.md` §2.1–2.3<br>• `POST /api/upload`<br>• `GET /api/synthetic`<br>• Vehicle + warehouse CRUD<br>• 3× seeders<br>• Empty-account checklist | **Phase B — #1, #2, #3, #5-display**<br>• `MapView.tsx`<br>• `mapThemes.ts`<br>• `MapChrome.tsx`<br>• Fix `POST /api/routes/geometry`<br>• `POST /api/map/summary`<br>• Use mock `Assignment` / `Route`<br>• **Do not touch engine math** |
| **Sprint 2** | **Phase D — #7, #10**<br>• `cost.py`<br>• `fuel.py`<br>• `ComparisonDashboard.tsx`<br>• Elbow trade-off view<br>• Start with mock distances from A<br>• Swap to live distances when C lands | **Phase C — #5-opt, #9, #12-engine**<br>• `routing.py`<br>• `traffic.py`<br>• `optimization.py`<br>• `GET /api/traffic/flow`<br>• `GET /api/traffic/history`<br>• Optimize-on-traffic toggle<br>• Expose only: `congestion_pct`, `travel_time_min`, `routing_note`, `traffic_note` |
| **Sprint 3** | **Phase E — #11**<br>• `expansion.py`<br>• `POST /api/expand`<br>• `WarehouseExpansion.tsx`<br>• Reads **A + D only**<br>• Policy controls:<br>&nbsp;&nbsp;– `allow_abandon_infra`<br>&nbsp;&nbsp;– `allow_sell_vehicles`<br>&nbsp;&nbsp;– `horizon_months`<br>&nbsp;&nbsp;– `revenue_per_order` | **Phase F-Shell — #14, #12-ui, #13**<br>• Overview tab shell<br>• `ScenariosPanel.tsx`<br>• Orchestrator stub<br>• Poll live fuel / traffic / population<br>• Sliders → collapsed overrides |
| **Sprint 4** | **Integration — Phase E → D**<br>• Reconcile E outputs with D figures<br>• Joint demo | **Integration — Phase F + C + D**<br>• Complete F loop<br>• `simulation_mode = realtime`<br>• Spillover with hysteresis<br>• Requires C + D to be landed<br>• Update `prd.md`<br>• Update `schema.md`<br>• Update `demo_script.md` |

## Dependency Flow

```text
PERSON 1
A: Data ────────→ D: Cost/Fuel ───────→ E: Expansion
                                      │
                                      └──────→ Integration

PERSON 2
B: Map ─────────→ C: Routing/Traffic ──→ F: Realtime Simulation
                                      │
                                      └──────→ Integration

                    ┌──────────────────────────┐
                    │      SPRINT 4 DEMO       │
                    │  A + B + C + D + E + F   │
                    └──────────────────────────┘
```

## Key Rules

### Person 1

- A is the foundation for D.
- D starts with mocked distances and switches to C's live distances once available.
- E consumes **only A + D**.
- Sprint 4 reconciles E's outputs against D's cost figures.

### Person 2

- B is purely presentation/map infrastructure.
- **No routing-engine changes during Sprint 1.**
- C owns routing, traffic, and optimization logic.
- F consumes C + D for the realtime simulation loop.
- Keep the exposed routing/traffic contract minimal:
  - `congestion_pct`
  - `travel_time_min`
  - `routing_note`
  - `traffic_note`
