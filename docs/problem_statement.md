# GRIDPOINT: Where Should the Warehouse Go?[cite: 1]

## Background
An e-commerce company serves several neighborhoods from a central distribution network[cite: 1]. Each neighborhood has a different number of daily orders and is located at a different geographical position[cite: 1]. The company wants to establish one or more warehouses such that the overall delivery effort and cost are minimized[cite: 1].

## Problem Statement
Build a **Warehouse Location Optimization Platform** that determines where the warehouse(s) should be located and which neighborhoods should be assigned to each warehouse[cite: 1]. The system should minimize weighted delivery cost, where neighborhoods with more orders contribute more heavily to the objective[cite: 1].

## Core Requirements
- Allow users to upload or enter neighborhood data including location and daily orders[cite: 1].
- Visualize all neighborhood locations on a map[cite: 1].
- Allow the user to select the number of warehouses[cite: 1].
- Run an optimization algorithm to determine suitable warehouse locations[cite: 1].
- Assign each neighborhood to its nearest or optimal warehouse[cite: 1].
- Calculate total delivery distance and cost[cite: 1].
- Display the optimized warehouse locations and assignments[cite: 1].
- Compare the original arrangement with the optimized arrangement[cite: 1].
- Consider warehouse capacity and maximum service radius where applicable[cite: 1].

## Bonus Features (Extra Points)
- Support multiple warehouses[cite: 1].
- Introduce limited warehouse capacity[cite: 1].
- Consider maximum delivery radius[cite: 1].
- Account for different vehicle types[cite: 1].
- Include fuel costs[cite: 1].
- Incorporate traffic-dependent delivery times[cite: 1].
- Model changes in customer demand[cite: 1].
- Explore the trade-off between infrastructure cost and delivery cost[cite: 1].

## Suggested Tech Stack
- **Optimization & Algorithms**: Python / C++ / Java[cite: 1]
- **Visualization Framework**: React, Streamlit, or similar frameworks[cite: 1]
- **Mapping Libraries**: Leaflet, Mapbox, or similar mapping tools[cite: 1]

## Deliverable
A working prototype + demo video showing[cite: 1]:
`Neighborhood Data` → `Location Visualization` → `Warehouse Optimization` → `Neighborhood Assignment` → `Delivery Cost Comparison`[cite: 1]

## Addendum — operator backlog (Sept 2026, docs-only plan, NOT part of the frozen assignment above)
The following operator requests are specified — but NOT implemented — in `phases.md` §0 (verbatim #1–#14) with concurrent execution phases A–F, plus matching spec in `prd.md` (§§5.1/5.2/5.5/5.7/5.9–5.11), `schema.md` (§§2.8–2.10 + routes contract), and `demo_script.md`: warehouse click-to-focus zone detail (#1); green→red coverage heatmap (#2); roads `Pair #0` error fix (#3); onboarding trio (orders + vehicles + existing warehouses, all seeded, empty new accounts) (#4); roads-derived traffic overlay + optimize-on-current-traffic (#5); daily-orders-on-nodes → warehouse assignment (#6, clarified); per-order road+fuel costing vs older way + populating Fuel-cost/Avg-congestion/Feasibility fields (#7); warehouse order aggregation (#8); dynamic traffic rerouting for time + money (#9); explicit infra-vs-delivery tradeoff (#10); expansion advisor with keep/abandon/demolish + keep/sell + revenue-aware recommendation (#11); automated live-feed Fleet ETA (#12); automated demand simulation with congestion spillover (#13); Overview tab aggregating vehicles/fuel/infra/orders/costs (#14).