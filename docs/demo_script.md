# GRIDPOINT — 2.5-Minute Demonstration Video Script

> **Hackathon Submission**: Hack-A-Matics  
> **Topic**: Where Should the Warehouse Go? (Multi-facility location & assignment optimization)  
> **Mandatory Pipeline Order**: `Neighborhood Data` → `Location Visualization` → `Warehouse Optimization` → `Neighborhood Assignment` → `Delivery Cost Comparison` → `Bonus Scenarios`  
> **Live Production URL**: [https://hackmatics-grid-point.vercel.app](https://hackmatics-grid-point.vercel.app)

---

## Video Timeline & Spoken Narration

### [0:00 – 0:20] 1. Problem Introduction & System Architecture
- **Visual**: Show GRIDPOINT landing page with Hyderabad demand dataset loaded and the 5 pipeline navigation badges (`1. Ingestion` → `2. Map Visualizer` → `3. Optimizer` → `4. Cost Comparison` → `5. Scenarios`).
- **Speaker**:
  > *"Hello judges! Welcome to GRIDPOINT. In modern e-commerce delivery, placing warehouses incorrectly burns millions in unnecessary transit mileage and fuel. Today, we're demonstrating GRIDPOINT — our end-to-end decision-support platform that minimizes demand-weighted delivery distance and logistics cost across 10 to 1,000+ neighborhood demand points using rigorous spatial optimization."*

---

### [0:20 – 0:45] 2. Neighborhood Data Ingestion & Strict Validation (Phase 1)
- **Visual**:
  - Click on **"1. Ingestion & Data"**.
  - Show the 10-node Hyderabad seed dataset (`Charminar`, `Banjara Hills`, `Hitec City`, `Gachibowli`, etc.).
  - Demonstrate clicking **"Generate Synthetic Dataset"** (show clustered distribution with $N=25$ nodes).
  - Briefly show the inline validation engine flagging coordinates outside WGS84 $[-90, 90]$ or negative orders.
- **Speaker**:
  > *"In Phase 1, users can upload real-world CSV or JSON delivery records, or generate realistic clustered demand patterns. Our validation engine guarantees WGS84 coordinate bounds and positive order counts, automatically mapping common aliases like 'lat', 'lng', and 'demand' into canonical schema structures."*

---

### [0:45 – 1:05] 3. Interactive Spatial Map Visualization (Phase 2)
- **Visual**:
  - Switch to **"2. Map Visualizer"**.
  - Pan and zoom on the interactive Leaflet map.
  - Hover over bubbles to display tooltips: neighborhood name, coordinates, and daily orders.
  - Point out that bubble radius scales with $\sqrt{\text{daily orders}}$ so high-density demand centers like Hitec City immediately stand out.
- **Speaker**:
  > *"Moving to Phase 2: Location Visualization. All neighborhood demand points are rendered on OpenStreetMap tiles with bubble diameters proportional to order volume. High-volume hubs like Hitec City and Gachibowli are immediately apparent, giving supply chain managers instant geographic intuition."*

---

### [1:05 – 1:30] 4. Multi-Warehouse Optimization Engine (Phase 3)
- **Visual**:
  - Switch to **"3. Warehouse Optimizer"**.
  - Set warehouse count slider $K = 2$, choose **Haversine** great-circle distance metric.
  - Show the optional toggles for capacity limit ($C_{\max}$) and service radius ($R_{\max}$).
  - Click the green **"🚀 Run Network Optimization"** button.
  - Show the instant $(< 0.5\text{s})$ result banner: "Optimization Successful".
- **Speaker**:
  > *"Now for Phase 3: the optimization engine. For $K=1$, GRIDPOINT uses the Weiszfeld algorithm to compute the exact weighted geometric median. For multiple warehouses, it runs demand-weighted K-Means with k-means++ seeding and Fermat-Weber medoid refinement, backed by a PuLP MILP solver for capacitated facility location. In under 1 second, it computes optimal facility coordinates."*

---

### [1:30 – 1:50] 5. Neighborhood Assignment & Warehouse Metrics (Phase 3/4)
- **Visual**:
  - Scroll down to the **Optimized Warehouses** table and **Neighborhood Assignment Breakdown**.
  - Highlight warehouse pins `WH-1` and `WH-2`, with order allocations and capacity utilization percentages.
  - Show the assignment table indicating raw km distance, weighted distance ($w_i \times d_i$), and allocated cost.
- **Speaker**:
  > *"Here are the resulting facilities: Warehouse 1 serving the high-density Western tech corridor, and Warehouse 2 serving Central and Old City Hyderabad. Each neighborhood is assigned to its optimal hub, balancing volume and minimizing route effort."*

---

### [1:50 – 2:15] 6. Delivery Cost Comparison: Baseline vs. Optimized (Phase 4)
- **Visual**:
  - Click **"4. Cost Comparison"** tab.
  - Highlight the side-by-side metric cards:
    - **Total Delivery Cost**: Baseline $\$14,820 \to$ Optimized $\$5,190$ (**$\mathbf{64.9\%}$ Cost Saved**).
    - **Weighted Distance**: $14,820\text{ km}\cdot\text{orders} \to 5,190\text{ km}\cdot\text{orders}$.
    - **Average Distance per Order**: $6.8\text{ km} \to 2.4\text{ km}$.
  - Scroll down to show the **Distance Distribution Histogram** and the assignment vector spider-lines connecting each customer node to its warehouse.
  - Click **"Download Comparison CSV"** to demonstrate report export.
- **Speaker**:
  > *"In Phase 4, we quantify the business value. Compared against the single-hub baseline, our 2-warehouse network slashes total delivery cost by over 60%, reducing average customer delivery distance from 6.8 kilometers down to just 2.4 kilometers. The distance distribution histogram confirms that over 80% of orders are now delivered within a short 3-kilometer radius."*

---

### [2:15 – 2:45] 7. Advanced Scenarios & Bonus Features (Phase 5)
- **Visual**:
  - Switch to **"5. Scenarios & Fleet"**.
  - **Feature 1 (Elbow Analysis)**: Adjust the **Infrastructure Cost per Hub** slider to $\$1,500$. Show the interactive curve balancing facility rent against transit cost, recommending **Optimal $K = 3$**.
  - **Feature 2 (Demand Surge)**: Move the **Demand Multiplier** slider to **$+50\%$ Festive Peak**. Click **"Apply Shift & Re-Optimize"** — show total volume surge and updated layout.
  - **Feature 3 (Fleet & Traffic ETA)**: Adjust rush-hour congestion slider to **$+40\%$ Delay**, switch vehicle to **Cargo E-Bike**, and observe real-time average ETA and fuel consumption burn.
  - **Feature 4 (Diagnostics)**: Point to the **Constraint Compliance** badge and warehouse utilization meters.
- **Speaker**:
  > *"Finally, in Phase 5, GRIDPOINT goes beyond static math to provide true operational stress-testing:
  > First, our Infrastructure vs. Delivery trade-off curve balances fixed facility rent against transit mileage to reveal the exact mathematical elbow for $K$.
  > Second, the Demand Shift Simulator stress-tests holiday surges up to $+100\%$ volume.
  > Third, our Fleet & Traffic Engine recalculates delivery ETAs and fuel consumption under peak-hour congestion for bikes, vans, and trucks.
  > And fourth, automated diagnostics safeguard against capacity overflows and service radius violations."*

---

### [2:45 – 3:00] 8. Conclusion & Repository Link
- **Visual**: Return to Header showing live URL `https://hackmatics-grid-point.vercel.app` and GitHub repository.
- **Speaker**:
  > *"GRIDPOINT is fully open-source, deployable on Vercel with NeonDB persistence, and backed by a comprehensive 64-test suite running in under 3 seconds. Thank you!"*

---

## Quick Reference Checksheet for Recording

| Timestamp | Screen / Action | Key Metric to Call Out |
| :--- | :--- | :--- |
| `0:00` | Landing Page & Architecture | 5-stage pipeline order |
| `0:20` | Tab 1: Ingestion & Synthetic generator | 10–1000 nodes, WGS84 validation |
| `0:45` | Tab 2: Leaflet Map & controls | Bubble radius $\propto \sqrt{\text{orders}}$ |
| `1:05` | Tab 3: K=2, Haversine, Weiszfeld / K-Means | Runtime $< 1.0\text{s}$ |
| `1:30` | Tab 3: Warehouses & Assignment table | Utilization % and assigned orders |
| `1:50` | Tab 4: Baseline vs Optimized dashboard | $\sim 60\%+$ cost reduction, histogram |
| `2:15` | Tab 5: Multi-K Elbow trade-off curve | Sweet-spot Optimal $K$ |
| `2:30` | Tab 5: Demand surge + Traffic ETA | Live ETA and fuel liters |
| `2:45` | Live prod URL + GitHub link | Complete pipeline demonstrability |
