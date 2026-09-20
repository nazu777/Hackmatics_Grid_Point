# GRIDPOINT — 2.5-Minute Demonstration Video Script

> **Hackathon Submission**: Hack-A-Matics  
> **Topic**: Where Should the Warehouse Go? (Multi-facility location & assignment optimization)  
> **Mandatory Pipeline Order**: `Neighborhood Data` → `Location Visualization` → `Warehouse Optimization` → `Neighborhood Assignment` → `Delivery Cost Comparison` → `Bonus Scenarios` → `Overview`
> **Backlog note (Sept 20 2026)**: beats below cover user items #1–#14 (see `phases.md` §0). Phases A–F are ALL SHIPPED and demoable (Person 1: A/D/E; Person 2: B/C/F).  
> **Live Production URL**: [https://hackmatics-grid-point.vercel.app](https://hackmatics-grid-point.vercel.app)

---

## Video Timeline & Spoken Narration

### [0:00 – 0:20] 1. Problem Introduction & System Architecture
- **Visual**: Show the GRIDPOINT landing page (`/`), log in (JWT auth; every account starts EMPTY), and land on `/app/ask`. Point out the Gmaps icon rail (`Ask → Saved → Optimize → Compare → Demand data → Scenario lab → Export → Settings → Help`) covering the 5 pipeline stages plus extras.
- **Speaker**:
  > *"Hello judges! Welcome to GRIDPOINT. In modern e-commerce delivery, placing warehouses incorrectly burns millions in unnecessary transit mileage and fuel. Today, we're demonstrating GRIDPOINT — our end-to-end decision-support platform that minimizes demand-weighted delivery distance and logistics cost across 10 to 1,000+ neighborhood demand points using rigorous spatial optimization."*

---

### [0:20 – 0:45] 2. Neighborhood Data Ingestion & Strict Validation (Phase 1 → Phase A onboarding trio)
- **Visual**:
  - Open **Demand data**.
  - Accounts start EMPTY — the onboarding checklist needs all three (#4): (i) order neighborhoods — click **Load sample** for the 10-node Hyderabad seed (`Charminar`, `Banjara Hills`, `Hitec City`, `Gachibowli`, etc.), or upload CSV/JSON, or open **Generate Synthetic Dataset** (clustered, $N=25$) / **Census seeder** (real US tract demand); (ii) owned vehicles — fleet table + vehicles seeder (SHIPPED); (iii) existing warehouses — warehouse table + warehouses seeder (SHIPPED). Daily orders live on nodes and each node lands in exactly one warehouse's zone (#6, #8).
  - Briefly show the inline validation engine flagging coordinates outside WGS84 $[-90, 90]$ or negative orders (see `sample_with_errors.csv`).
- **Speaker**:
  > *"In Phase 1, users can upload real-world CSV or JSON delivery records, seed real US Census demand, or generate realistic clustered demand patterns — plus their owned vehicles and existing warehouses, each with a one-click synthetic seeder for demos. Our validation engine guarantees WGS84 coordinate bounds and positive order counts, automatically mapping common aliases like 'lat', 'lng', and 'demand' into canonical schema structures. Every daily order lives on a node, and every node is assigned to exactly one warehouse zone."*

---

### [0:45 – 1:05] 3. Interactive Spatial Map Visualization (Phase 2 → Phase B)
- **Visual**:
  - Show the full-bleed **Mapbox GL map** (Standard/Light/Dark styles).
  - Pan and zoom; hover bubbles for tooltips: neighborhood name, coordinates, and daily orders.
  - Point out that bubble radius scales with $\sqrt{\text{daily orders}}$ so high-density demand centers like Hitec City immediately stand out. Toggle layer chips (warehouses/routes/demand/radius/traffic).
  - Click a warehouse: its zone detail opens (assigned node list + summed daily orders), other zones dim, the selected zone highlights (#1). Toggle the green→red coverage heatmap (#2) and the corridor-traffic overlay derived from traced roads (#5). Flip displacement→roads: road paths appear with a friendly notice if any path is unavailable — never a raw `Pair #0…` error (#3).
- **Speaker**:
  > *"Moving to location visualization: all neighborhood demand points are rendered on a Mapbox map with bubble diameters proportional to order volume. Clicking any warehouse isolates its zone with its full node roster; the green-to-red heatmap shows coverage at a glance, and the traffic overlay comes straight from the traced road network."*

---

### [1:05 – 1:30] 4. Multi-Warehouse Optimization Engine (Phase 3 → Phase C)
- **Visual**:
  - Open **Optimize**.
  - Set warehouse count slider $K = 2$, choose **Haversine** great-circle distance metric (Euclidean / Manhattan / **Road** also available — Road re-optimizes on real driving distances).
  - Show capacity ($C_{\max}$), service radius ($R_{\max}$), live fuel, and live traffic toggles (ON by default) PLUS the SHIPPED **Optimize on current traffic** switch (#5-opt) and **traffic-aware reroute** for time + money (#9).
  - Click **Run Network Optimization**.
  - Show the instant result banner: "Optimization Successful". Optionally demo **WarehouseExpansion** (add a warehouse without moving existing sites, before-after slider).
- **Speaker**:
  > *"Now for the optimization engine. For $K=1$, GRIDPOINT uses the Weiszfeld algorithm to compute the exact weighted geometric median. For multiple warehouses, it runs demand-weighted K-Means with k-means++ seeding and Fermat-Weber medoid refinement, backed by a PuLP MILP solver for capacitated facility location — plus an optional road mode that optimizes on real driving distances, and a traffic-aware mode that re-routes on current corridor conditions to save both minutes and rupees."*

---

### [1:30 – 1:50] 5. Neighborhood Assignment & Warehouse Metrics (Phase 3/4)
- **Visual**:
  - Scroll to the **Optimized Warehouses** table and **Neighborhood Assignment Breakdown**.
  - Highlight warehouse pins `W1` and `W2`, with order allocations and capacity utilization percentages.
  - Show the assignment table: raw km distance, weighted distance ($w_i \times d_i$), allocated cost, and per-node fuel cost.
- **Speaker**:
  > *"Here are the resulting facilities: Warehouse 1 serving the high-density Western tech corridor, and Warehouse 2 serving Central and Old City Hyderabad. Each neighborhood is assigned to its optimal hub, balancing volume and minimizing route effort."*

---

### [1:50 – 2:15] 6. Delivery Cost Comparison: Baseline vs. Optimized (Phase 4 → Phase D)
- **Visual**:
  - Click **Compare**. Baseline defaults to the user's OWNED existing warehouses (#4); per-order road km × fuel-API price gives per-node fuel + cost (#7).
  - Highlight the side-by-side metric cards (numbers below are the recorded example — your live run will vary):
    - **Total Delivery Cost**: Baseline $\$14,820 \to$ Optimized $\$5,190$ (**$\mathbf{64.9\%}$ Cost Saved**).
    - **Weighted Distance**: $14,820\text{ km}\cdot\text{orders} \to 5,190\text{ km}\cdot\text{orders}$.
    - **Average Distance per Order**: $6.8\text{ km} \to 2.4\text{ km}$.
    - **Per-node avg cost per order** table: optimized vs older-way per node + overall (#7); `Fuel cost portion ($)`, `Avg corridor congestion`, `Feasibility ratio` all populated, never blank (#7).
  - Scroll to the **Distance Distribution Histogram**, the fuel-reduction graph, the assignment vectors (displacement lines or traced road paths), and the annotated **infra-vs-delivery tradeoff elbow** with its plain-language "why this K" caption (#10).
  - Click **Download Comparison CSV** (metrics + assignments exports) to demonstrate report export.
- **Speaker**:
  > *"In cost comparison, every order is priced on its road distance and live fuel rate — per node and overall, optimized versus your current warehouses. The tradeoff chart makes the infrastructure-versus-delivery decision explicit instead of a hidden slider."*

---

### [2:15 – 2:45] 7. Advanced Scenarios & Bonus Features (Phase 5 → Phases E–F)
- **Visual**:
  - Open **Scenario lab**.
  - **Feature 1 (Elbow Analysis)**: Adjust the **Infrastructure Cost per Hub** slider to $\$1,500$. Show the interactive curve balancing facility rent against transit cost, recommending **Optimal $K$** (#10).
  - **Feature 2 (Demand Surge, now automated)**: flip `simulation_mode=realtime` — demand/traffic/fuel drive the surge; congestion near a warehouse spills nodes across until it clears, with an event log (#13). Manual multiplier survives only as an offline override.
  - **Feature 3 (Fleet & Traffic ETA, now automated)**: ETA reads live fuel + traffic + population feeds on a tick — no sliders in the default path (#12); switch vehicle to **Cargo E-Bike** and watch ETA + fuel burn follow live data.
  - **Feature 4 (Expansion advisor)**: enter current warehouses + neighborhoods + vehicles, toggle keep vs abandon/demolish infra and keep vs sell vehicles, and show the ONE revenue-aware recommended plan with costed rationale (#11).
  - **Feature 5 (Diagnostics + Road mode)**: **Constraint Compliance** badge + utilization meters; **Roads** mode re-optimizes on driving distances with traced paths and isochrone heatmaps.
- **Speaker**:
  > *"Scenarios are now driven by live data, not sliders: surges spill nodes across warehouses automatically, fleet ETAs follow real fuel and traffic, and the expansion advisor prices keeping versus abandoning your current sites and vehicles — with future revenue in the math."*

---

### [2:45 – 3:00] 8. Overview + Conclusion (Phase F, #14)
- **Visual**: Open the **Overview tab**: vehicle count + mix, current fuel price(s) + provenance, infra price(s), warehouse count + utilization, order totals, distance/cost/fuel/congestion/feasibility summaries, pending simulation/expansion alerts — each figure linking back to its source tab. Then show the live URL `https://hackmatics-grid-point.vercel.app` and GitHub repository. Mention `make test` (159 tests, 25 files) and `make sync-api` (Vercel bundle hygiene).
- **Speaker**:
  > *"And the Overview tab ties it together — every vehicle, fuel price, infra cost, warehouse, and order in one audited screen. GRIDPOINT is fully open-source, deployable on Vercel with live fuel/traffic/Census integrations, JWT auth with per-account workspaces, and backed by a comprehensive 159-test suite. Thank you!"*

---

## Quick Reference Checksheet for Recording

| Timestamp | Screen / Action | Key Metric to Call Out |
| :--- | :--- | :--- |
| `0:00` | Landing Page → login → `/app/ask` + rail | 5-stage pipeline order + extras + Overview |
| `0:20` | Demand data: onboarding trio (orders + vehicles + warehouses) + seeders | 10–1000 nodes, WGS84 validation, accounts start EMPTY; orders live on nodes |
| `0:45` | Mapbox map + click-to-focus + heatmap + traffic overlay | Zone isolate (#1), green→red gradient (#2), no `Pair #0` (#3) |
| `1:05` | Optimize: K=2, Haversine (/Road), traffic-aware toggle | Runtime $< 5\text{s}$ straight-line; road + traffic re-optimize (#5, #9) |
| `1:30` | Warehouses (W1…) & Assignment table | Utilization % and summed daily orders + fuel cost (#6, #8) |
| `1:50` | Compare: per-node + overall cost, 3 fixed fields, tradeoff elbow | Road+fuel truth, no blanks, infra-vs-delivery clarity (#7, #10) |
| `2:15` | Scenario lab: expansion advisor + automated ETA/surge | Keep/abandon/sell recommendation; live feeds, spillover log (#11–#13) |
| `2:30` | Overview tab | Vehicles/fuel/infra/orders/costs reconcile (#14) |
| `2:45` | Live prod URL + GitHub link | Complete pipeline demonstrability |
