"""
GridPoint — Warehouse Location & Assignment Optimization Platform
Phase 1: Data Ingestion & Setup (Streamlit UI)
"""
import streamlit as st
import pandas as pd
import json
import pydeck as pdk

from src.schema import SyntheticGenerationConfig, OptimizationConfig
from src.validation import validate_neighborhoods, validate_optimization_config
from src.data_ingestion import (
    parse_csv_content,
    parse_json_content,
    export_to_csv,
    export_to_json,
    compute_dataset_summary
)
from src.synthetic import generate_synthetic_dataset
from src.optimization import run_optimization
from src.mapping import prepare_map_layer_data, compute_map_bounds
from src.scenarios import compute_tradeoff_curve, simulate_demand_shift, calculate_fleet_eta, diagnose_constraints

st.set_page_config(
    page_title="GridPoint — Warehouse Location Optimization",
    page_icon="📍",
    layout="wide",
    initial_sidebar_state="expanded"
)

# Custom Styling
st.markdown("""
<style>
    .main-header {
        font-size: 2.2rem;
        font-weight: 700;
        color: #1E293B;
        margin-bottom: 0.2rem;
    }
    .sub-header {
        font-size: 1.05rem;
        color: #64748B;
        margin-bottom: 1.5rem;
    }
    .metric-card {
        background-color: #F8FAFC;
        border: 1px solid #E2E8F0;
        border-radius: 8px;
        padding: 1rem;
    }
    .error-box {
        background-color: #FEF2F2;
        border-left: 4px solid #EF4444;
        padding: 0.75rem 1rem;
        margin: 0.5rem 0;
        border-radius: 4px;
    }
    .success-box {
        background-color: #F0FDF4;
        border-left: 4px solid #22C55E;
        padding: 0.75rem 1rem;
        margin: 0.5rem 0;
        border-radius: 4px;
    }
</style>
""", unsafe_allow_html=True)

# Initialize Session State
if "neighborhoods" not in st.session_state:
    # Default initial dataset: 10 synthetic clustered nodes around Hyderabad
    default_config = SyntheticGenerationConfig(N=15, seed=42)
    st.session_state.neighborhoods = generate_synthetic_dataset(default_config)

if "validation_result" not in st.session_state:
    val_res, _ = validate_neighborhoods(st.session_state.neighborhoods)
    st.session_state.validation_result = val_res

if "active_phase" not in st.session_state:
    st.session_state.active_phase = "Phase 2: Location Visualization & Spatial Mapping"

# Title & Pipeline Banner
st.markdown('<div class="main-header">📍 GRIDPOINT</div>', unsafe_allow_html=True)
st.markdown(
    '<div class="sub-header">Warehouse Location & Assignment Optimization Platform &bull; '
    '<strong>Phase 1: Ingestion</strong> &bull; <strong>Phase 2: Spatial Mapping</strong></div>',
    unsafe_allow_html=True
)

# Pipeline Flow Navigation Bar
phase_selection = st.radio(
    "Active Pipeline Stage:",
    [
        "Phase 1: Data Ingestion & Validation",
        "Phase 2: Location Visualization & Spatial Mapping"
    ],
    horizontal=True,
    index=1 if st.session_state.active_phase.startswith("Phase 2") else 0
)
st.session_state.active_phase = phase_selection

# Sidebar Controls
with st.sidebar:
    st.header("⚙️ Pipeline Stage & Config")

    if st.session_state.active_phase.startswith("Phase 1"):
        input_mode = st.radio(
            "Choose Ingestion Method:",
            ["🎲 Synthetic Generator", "📁 File Upload (CSV/JSON)", "✏️ Manual Data Table"],
            index=0
        )
    else:
        st.subheader("🗺️ Optimization Controls (K & Metric)")
        k_val = st.slider("Warehouses to Place (K)", min_value=1, max_value=10, value=2, help="Number of facilities K to optimize")
        metric_val = st.selectbox(
            "Distance Metric",
            ["haversine", "euclidean", "manhattan"],
            index=0,
            help="Haversine = spherical Earth km; Euclidean = flat coordinate; Manhattan = grid block"
        )

        with st.expander("🛡️ Constraints & Costs", expanded=False):
            cap_enabled = st.checkbox("Enable Capacity Constraint (C_max)", value=False)
            c_max = st.number_input("Max Orders per Warehouse (C_max)", value=1000, min_value=1) if cap_enabled else None
            rad_enabled = st.checkbox("Enable Radius Constraint (R_max)", value=False)
            r_max = st.number_input("Max Radius in km (R_max)", value=25.0, min_value=0.5) if rad_enabled else None
            cost_km = st.number_input("Cost per km ($)", value=1.0, min_value=0.0)

        st.session_state.opt_config = OptimizationConfig(
            K=k_val,
            distance_metric=metric_val,
            capacity_enabled=cap_enabled,
            C_max=c_max,
            radius_enabled=rad_enabled,
            R_max_km=r_max,
            cost_per_km=cost_km
        )

    st.divider()
    st.markdown("### 📥 Quick Load Samples")
    col_sample1, col_sample2 = st.columns(2)
    with col_sample1:
        if st.button("Hyderabad (20)"):
            with open("../data/samples/hyderabad_demand.csv" if pd.io.common.file_exists("../data/samples/hyderabad_demand.csv") else "data/samples/hyderabad_demand.csv", "r") as f:
                val, nodes = parse_csv_content(f.read())
                st.session_state.neighborhoods = nodes
                st.session_state.validation_result = val
                st.rerun()
    with col_sample2:
        if st.button("Errors Sample"):
            with open("../data/samples/sample_with_errors.csv" if pd.io.common.file_exists("../data/samples/sample_with_errors.csv") else "data/samples/sample_with_errors.csv", "r") as f:
                val, nodes = parse_csv_content(f.read())
                st.session_state.neighborhoods = nodes
                st.session_state.validation_result = val
                st.rerun()

# Main Pipeline Stage Views
if st.session_state.active_phase.startswith("Phase 1"):
    if input_mode == "🎲 Synthetic Generator":
        st.subheader("🎲 Synthetic Dataset Generator (schema.md §2.8)")
        st.caption("Generate realistic, seedable geographic demand clusters for instant simulation.")

        with st.expander("🛠️ Generator Parameters", expanded=True):
            col1, col2, col3 = st.columns(3)
            with col1:
                n_nodes = st.slider("Neighborhoods Count (N)", min_value=5, max_value=1000, value=25, step=5)
                dist_type = st.selectbox("Distribution Type", ["clustered", "uniform", "gaussian"], index=0)
                clusters_count = st.slider("Number of Clusters", min_value=1, max_value=8, value=3) if dist_type == "clustered" else 1

            with col2:
                lat_c = st.number_input("Center Latitude", value=17.385044, format="%.6f")
                lon_c = st.number_input("Center Longitude", value=78.486671, format="%.6f")
                spread_km = st.slider("Spread Radius (km)", min_value=5.0, max_value=100.0, value=20.0, step=2.5)

            with col3:
                min_ord = st.number_input("Min Daily Orders", value=20, min_value=0, max_value=500)
                max_ord = st.number_input("Max Daily Orders", value=250, min_value=1, max_value=2000)
                seed_val = st.number_input("Random Seed", value=42, min_value=1, max_value=99999)

            if st.button("✨ Generate Synthetic Dataset", type="primary"):
                if min_ord > max_ord:
                    st.error("Min Daily Orders cannot be greater than Max Daily Orders!")
                else:
                    synth_config = SyntheticGenerationConfig(
                        N=n_nodes,
                        lat_center=lat_c,
                        lon_center=lon_c,
                        spread_km=spread_km,
                        distribution=dist_type, # type: ignore
                        num_clusters=clusters_count,
                        orders_min=min_ord,
                        orders_max=max_ord,
                        seed=seed_val
                    )
                    generated = generate_synthetic_dataset(synth_config)
                    val_res, clean_nodes = validate_neighborhoods(generated)
                    st.session_state.neighborhoods = clean_nodes
                    st.session_state.validation_result = val_res
                    st.success(f"Generated {len(clean_nodes)} synthetic neighborhoods successfully!")
                    st.rerun()

    elif input_mode == "📁 File Upload (CSV/JSON)":
        st.subheader("📁 Upload Neighborhood Dataset (schema.md §3)")
        st.caption("Supports CSV and JSON files with automatic header detection and alias normalization.")

        uploaded_file = st.file_uploader(
            "Upload CSV or JSON File",
            type=["csv", "json", "txt"],
            help="Required fields: neighborhood_id, latitude, longitude, daily_orders. Optional: name, zone."
        )

        if uploaded_file is not None:
            file_bytes = uploaded_file.read()
            try:
                content_str = file_bytes.decode("utf-8")
            except UnicodeDecodeError:
                content_str = file_bytes.decode("latin-1")

            if uploaded_file.name.endswith(".json"):
                val_res, clean_records = parse_json_content(content_str)
            else:
                val_res, clean_records = parse_csv_content(content_str)

            st.session_state.validation_result = val_res
            if val_res.valid:
                st.session_state.neighborhoods = clean_records
                st.success(f"Successfully loaded and validated {len(clean_records)} records from `{uploaded_file.name}`!")
            else:
                st.session_state.neighborhoods = clean_records
                st.error(f"Validation failed on `{uploaded_file.name}` with {len(val_res.errors)} errors. See diagnostics below.")

    elif input_mode == "✏️ Manual Data Table":
        st.subheader("✏️ Interactive Tabular Data Editor")
        st.caption("Add, edit, or delete neighborhood demand records interactively.")

        current_df = pd.DataFrame(st.session_state.neighborhoods)
        if current_df.empty:
            current_df = pd.DataFrame(columns=["neighborhood_id", "name", "latitude", "longitude", "daily_orders", "zone"])

        edited_df = st.data_editor(
            current_df,
            num_rows="dynamic",
            use_container_width=True,
            column_config={
                "neighborhood_id": st.column_config.TextColumn("Neighborhood ID (PK)", required=True),
                "name": st.column_config.TextColumn("Name / Label"),
                "latitude": st.column_config.NumberColumn("Latitude (°)", min_value=-90.0, max_value=90.0, format="%.6f", required=True),
                "longitude": st.column_config.NumberColumn("Longitude (°)", min_value=-180.0, max_value=180.0, format="%.6f", required=True),
                "daily_orders": st.column_config.NumberColumn("Daily Orders (w_i)", min_value=0, step=1, required=True),
                "zone": st.column_config.TextColumn("Zone / Cluster")
            }
        )

        if st.button("💾 Apply & Validate Changes", type="primary"):
            val_res, clean_records = validate_neighborhoods(edited_df)
            st.session_state.validation_result = val_res
            st.session_state.neighborhoods = clean_records
            if val_res.valid:
                st.success(f"Saved and validated {len(clean_records)} records successfully!")
            else:
                st.warning(f"Validation found {len(val_res.errors)} issues in edited records.")
            st.rerun()

else:
    # Phase 2: Location Visualization & Spatial Mapping View
    st.subheader("🗺️ Geographic Demand Map & Spatial Distribution (Phase 2)")
    st.caption("Interactive demand bubbles sized by order volume (radius ∝ √w_i) with PyDeck auto-fit viewport.")

    layer_data = prepare_map_layer_data(st.session_state.neighborhoods)
    nodes = layer_data["nodes"]
    bounds_info = layer_data["bounds_info"]

    if nodes:
        map_df = pd.DataFrame(nodes)

        # PyDeck ScatterplotLayer for demand bubbles
        scatterplot_layer = pdk.Layer(
            "ScatterplotLayer",
            data=map_df,
            get_position=["longitude", "latitude"],
            get_radius="visual_radius * 45", # Scale in meters for geographical visibility
            get_fill_color="color_rgb",
            pickable=True,
            auto_highlight=True,
            opacity=0.75,
            stroked=True,
            filled=True,
            get_line_color=[255, 255, 255],
            line_width_min_pixels=1.5
        )

        # View state centered on dataset bounding box
        view_state = pdk.ViewState(
            latitude=bounds_info["center"]["lat"],
            longitude=bounds_info["center"]["lon"],
            zoom=bounds_info["suggested_zoom"],
            pitch=0
        )

        # PyDeck deck rendering
        deck = pdk.Deck(
            layers=[scatterplot_layer],
            initial_view_state=view_state,
            map_style="light",
            tooltip={
                "html": "<b>{name}</b> ({neighborhood_id})<br/>"
                        "Daily Orders: <b>{daily_orders}</b> ({demand_category})<br/>"
                        "Coords: {latitude}°, {longitude}°",
                "style": {"backgroundColor": "#1E293B", "color": "#FFFFFF", "fontSize": "12px", "borderRadius": "8px"}
            }
        )

        col_map, col_info = st.columns([3, 1])
        with col_map:
            st.pydeck_chart(deck, use_container_width=True)

        with col_info:
            st.markdown("### 📍 Map Insights")
            st.metric("Total Mapped Nodes", len(nodes))
            st.metric("Min Daily Orders", layer_data["min_orders"])
            st.metric("Max Daily Orders", layer_data["max_orders"])
            st.metric("Geographic Span", f"{bounds_info['span_km']} km")

            st.divider()
            st.markdown("""
            **Bubble Palette Legend**:
            - 🟢 **Emerald**: Low Demand ($<33\%$)
            - 🟡 **Amber**: Medium Demand ($33–66\%$)
            - 🔴 **Rose**: High Demand ($>66\%$)
            """)

            opt_cfg = st.session_state.get("opt_config")
            if opt_cfg:
                st.info(f"Target Warehouses: **K={opt_cfg.K}**\n\nMetric: **{opt_cfg.distance_metric.title()}**")
    else:
        st.warning("No valid coordinate records available to render on the map.")

st.divider()

# Dataset Summary & Diagnostics
summary = compute_dataset_summary(st.session_state.neighborhoods)
val_result = st.session_state.validation_result

col_m1, col_m2, col_m3, col_m4 = st.columns(4)
col_m1.metric("Total Demand Nodes", summary["count"])
col_m2.metric("Total Daily Orders (Σ w_i)", f"{summary['total_orders']:,}")
col_m3.metric("Avg Orders / Node", f"{summary['avg_orders']:.1f}")
col_m4.metric(
    "Validation Status",
    "✅ Valid" if val_result.valid else f"❌ {len(val_result.errors)} Errors",
    delta=None if val_result.valid else f"{len(val_result.warnings)} warnings"
)

# Validation Error Diagnostics Drawer
if not val_result.valid:
    st.markdown("### ⚠️ Validation Issues Detected")
    err_df = pd.DataFrame([e.model_dump() for e in val_result.errors])
    st.dataframe(err_df, use_container_width=True)

# Data Preview & Export Bar
st.markdown("### 📋 Active Neighborhood Dataset")
if st.session_state.neighborhoods:
    active_df = pd.DataFrame(st.session_state.neighborhoods)
    st.dataframe(active_df, use_container_width=True, height=280)

    # Export options
    col_exp1, col_exp2, _ = st.columns([1, 1, 3])
    with col_exp1:
        csv_data = export_to_csv(st.session_state.neighborhoods)
        st.download_button(
            label="⬇️ Export Canonical CSV",
            data=csv_data,
            file_name="gridpoint_neighborhoods.csv",
            mime="text/csv"
        )
    with col_exp2:
        json_data = export_to_json(st.session_state.neighborhoods)
        st.download_button(
            label="⬇️ Export JSON",
            data=json_data,
            file_name="gridpoint_neighborhoods.json",
            mime="application/json"
        )
else:
    st.warning("No neighborhood records currently loaded.")

# ==========================================
# PHASE 3: WAREHOUSE OPTIMIZATION ENGINE
# ==========================================
st.divider()
st.subheader("⚡ Phase 3: Warehouse Optimization Engine (schema.md §2, PRD §5.4)")
st.caption("Solves Weiszfeld geometric median (K=1), Weighted K-Means (K>1), or PuLP CFLP with capacity and radius constraints.")

col_opt1, col_opt2, col_opt3 = st.columns(3)

with col_opt1:
    k_val = st.slider(
        "Warehouses Count (K)",
        min_value=1,
        max_value=min(10, max(1, len(st.session_state.neighborhoods))),
        value=min(2, max(1, len(st.session_state.neighborhoods)))
    )
    metric_choice = st.selectbox(
        "Distance Function",
        ["haversine", "euclidean", "manhattan"],
        format_func=lambda m: f"{m.capitalize()} ({'Great-circle km' if m=='haversine' else 'Planar km' if m=='euclidean' else 'Grid routing km'})"
    )

with col_opt2:
    cap_on = st.checkbox("Enforce Capacity Constraint (C_max)", value=False)
    c_max_val = st.number_input(
        "Max Orders / Warehouse",
        min_value=10,
        value=500,
        step=50,
        disabled=not cap_on
    )
    rad_on = st.checkbox("Enforce Service Radius (R_max)", value=False)
    r_max_val = st.number_input(
        "Max Service Radius (km)",
        min_value=1.0,
        value=15.0,
        step=1.0,
        disabled=not rad_on
    )

with col_opt3:
    rate_val = st.number_input("Cost Rate ($/km·order)", min_value=0.1, value=1.0, step=0.1)
    base_mode = st.selectbox("Baseline Layout Mode", ["centroid", "mean", "single_center"])

if st.button("🚀 Run Warehouse Optimization", type="primary"):
    if not st.session_state.neighborhoods:
        st.error("Cannot run optimization with 0 demand nodes.")
    else:
        with st.spinner("Executing mathematical optimization algorithms..."):
            opt_config = OptimizationConfig(
                K=k_val,
                distance_metric=metric_choice, # type: ignore
                capacity_enabled=cap_on,
                C_max=int(c_max_val) if cap_on else None,
                radius_enabled=rad_on,
                R_max_km=float(r_max_val) if rad_on else None,
                cost_per_km=float(rate_val),
                baseline_mode=base_mode, # type: ignore
                random_seed=42
            )
            opt_res = run_optimization(st.session_state.neighborhoods, opt_config)
            st.session_state.opt_result = opt_res

if "opt_result" in st.session_state and st.session_state.opt_result is not None:
    opt_res = st.session_state.opt_result
    st.markdown("### 📊 Optimization Results & Evaluation")

    if not opt_res.is_feasible:
        st.warning(f"⚠️ **Feasibility Notice**: {opt_res.infeasibility_reason}")

    # Delta savings cards
    if opt_res.comparison:
        c_res1, c_res2, c_res3 = st.columns(3)
        delta = opt_res.comparison.delta
        c_res1.metric(
            "Weighted Distance Saved",
            f"{delta.pct_distance_saved}%",
            f"{delta.weighted_distance_saved:,.1f} km·orders"
        )
        c_res2.metric(
            "Delivery Cost Reduction",
            f"{delta.pct_cost_saved}%",
            f"${delta.cost_saved:,.2f}"
        )
        c_res3.metric(
            "Avg Distance / Order",
            f"{opt_res.metrics.avg_distance_per_order_km:.2f} km",
            f"Baseline: {opt_res.comparison.baseline.metrics.avg_distance_per_order_km:.2f} km",
            delta_color="inverse"
        )

    # Warehouse locations table
    st.markdown(f"#### 📍 Optimized Warehouses (K = {len(opt_res.warehouses)})")
    wh_data = []
    for w in opt_res.warehouses:
        m = next((wm for wm in opt_res.metrics.warehouses if wm.warehouse_id == w.warehouse_id), None)
        wh_data.append({
            "Warehouse ID": w.warehouse_id,
            "Latitude": w.latitude,
            "Longitude": w.longitude,
            "Assigned Orders": w.assigned_orders,
            "Assigned Nodes": m.neighborhood_count if m else 0,
            "Utilization %": f"{w.utilization_pct}%" if w.utilization_pct is not None else "N/A"
        })
    st.dataframe(pd.DataFrame(wh_data), use_container_width=True)

    # Assignments table preview
    st.markdown(f"#### 📋 Neighborhood Assignments (Top 10 of {len(opt_res.assignments)})")
    asgn_data = [
        {
            "Neighborhood ID": a.neighborhood_id,
            "Warehouse ID": a.warehouse_id,
            "Distance (km)": a.distance_km,
            "Weighted Distance (km·orders)": a.weighted_distance,
            "Delivery Cost ($)": f"${a.cost:.2f}",
            "Within Radius": "✅ Yes" if a.within_radius else "❌ Exceeded"
        }
        for a in opt_res.assignments[:10]
    ]
    st.dataframe(pd.DataFrame(asgn_data), use_container_width=True)

# ==========================================
# PHASE 4: COST & COMPARATIVE EVALUATION
# ==========================================
if "opt_result" in st.session_state and st.session_state.opt_result is not None:
    from src.cost import distance_histogram, metrics_table_rows
    from src.mapping import assignment_lines, fit_bounds, map_points, to_geojson

    opt_res = st.session_state.opt_result
    st.divider()
    st.subheader("📈 Phase 4: Delivery Cost Comparison (PRD §5.6–5.7)")
    st.caption("Baseline vs optimized side-by-side, distance distribution, assignment map overlay, and exports.")

    if opt_res.comparison:
        base_m = opt_res.comparison.baseline.metrics
        opt_m = opt_res.metrics
        # Side-by-side baseline vs optimized cards
        b1, b2, b3, b4 = st.columns(4)
        b1.metric("Baseline Cost", f"${base_m.total_cost:,.2f}")
        b2.metric("Optimized Cost", f"${opt_m.total_cost:,.2f}",
                  f"-${base_m.total_cost - opt_m.total_cost:,.2f}")
        b3.metric("Baseline Wtd Dist", f"{base_m.total_weighted_distance_km_orders:,.1f}")
        b4.metric("Optimized Wtd Dist", f"{opt_m.total_weighted_distance_km_orders:,.1f}",
                  f"-{base_m.total_weighted_distance_km_orders - opt_m.total_weighted_distance_km_orders:,.1f}")

        # Full comparison table (exportable)
        st.markdown("#### ⚖️ Baseline vs Optimized — Full Metrics Table")
        rows = metrics_table_rows(base_m, opt_m)
        st.dataframe(pd.DataFrame(rows), use_container_width=True)

        # Distance distribution chart (optimized assignments)
        st.markdown("#### 📊 Distance Distribution (optimized, km)")
        hist = distance_histogram([a for a in opt_res.assignments], bins=10)
        hist_df = pd.DataFrame([
            {"bin": f"{h['bin_start']:.1f}–{h['bin_end']:.1f} km", "neighborhoods": h["count"]}
            for h in hist
        ]).set_index("bin")
        st.bar_chart(hist_df)

    # Assignment map overlay (demand bubbles + warehouses + lines count)
    st.markdown("#### 🗺️ Assignment Map Overlay")
    try:
        nb_dicts = st.session_state.neighborhoods
        wh_dicts = [w.model_dump() for w in opt_res.warehouses]
        asg_dicts = [a.model_dump() for a in opt_res.assignments]
        bounds = fit_bounds(nb_dicts, wh_dicts)
        st.caption(f"Bounds: lat [{bounds['min_lat']:.3f}, {bounds['max_lat']:.3f}] "
                   f"lon [{bounds['min_lon']:.3f}, {bounds['max_lon']:.3f}] • "
                   f"{len(assignment_lines(nb_dicts, wh_dicts, asg_dicts))} assignment lines")
        pts = map_points(nb_dicts, asg_dicts)
        map_df = pd.DataFrame([{"lat": p["latitude"], "lon": p["longitude"]} for p in pts] +
                              [{"lat": float(w["latitude"]), "lon": float(w["longitude"])}
                               for w in wh_dicts])
        st.map(map_df, zoom=10)
        # R_max circles notice
        if opt_res.config.radius_enabled and opt_res.config.R_max_km:
            st.info(f"⭕ Service radius R_max = {opt_res.config.R_max_km} km enabled — "
                    f"{opt_res.metrics.infeasible_assignments} assignments exceed radius.")
    except Exception as e:
        st.warning(f"Map overlay unavailable: {e}")

    # Exports: metrics CSV/JSON, assignments CSV, GeoJSON map snapshot
    st.markdown("#### ⬇️ Export Evaluation")
    e1, e2, e3 = st.columns(3)
    with e1:
        if opt_res.comparison:
            mrows = metrics_table_rows(opt_res.comparison.baseline.metrics, opt_res.metrics)
            mcsv = "metric,baseline,optimized,saved,pct_saved\n" + "\n".join(
                f"{r['metric']},{r['baseline']},{r['optimized']},{r['saved']},{r['pct_saved']}" for r in mrows)
            st.download_button("⬇️ Metrics Table (CSV)", data=mcsv,
                               file_name="gridpoint_metrics_comparison.csv", mime="text/csv")
    with e2:
        acsv = "neighborhood_id,warehouse_id,distance_km,weighted_distance,cost,within_radius,is_feasible\n" + "\n".join(
            f"{a.neighborhood_id},{a.warehouse_id},{a.distance_km},{a.weighted_distance},{a.cost},"
            f"{a.within_radius},{a.is_feasible}" for a in opt_res.assignments)
        st.download_button("⬇️ Assignments (CSV)", data=acsv,
                           file_name="gridpoint_assignments.csv", mime="text/csv")
    with e3:
        try:
            gj = to_geojson(st.session_state.neighborhoods,
                            [w.model_dump() for w in opt_res.warehouses],
                            [a.model_dump() for a in opt_res.assignments])
            st.download_button("⬇️ Map Snapshot (GeoJSON)", data=json.dumps(gj),
                               file_name="gridpoint_map.geojson", mime="application/json")
        except Exception as e:
            st.warning(f"GeoJSON export unavailable: {e}")

    # =========================================================================
    # Phase 5: Advanced Scenarios & Bonus Features (Streamlit UI)
    # =========================================================================
    st.markdown("---")
    st.markdown("### 🧪 Phase 5: What-If Scenarios & Bonus Decision-Support")
    st.caption("Stress-test infrastructure trade-offs, demand shocks, rush-hour congestion, and capacity constraints.")

    tab_elbow, tab_demand, tab_fleet, tab_diag = st.tabs([
        "📈 Infrastructure vs Delivery (Elbow)",
        "⚡ Customer Demand Shift",
        "🚚 Fleet & Traffic ETA",
        "⚠️ Constraint Diagnostics"
    ])

    with tab_elbow:
        st.markdown("#### Facility Rent vs Route Mileage Trade-off")
        c_el1, c_el2 = st.columns(2)
        with c_el1:
            infra_slider = st.slider("Infra Cost / Warehouse ($)", min_value=0, max_value=3000, value=500, step=100)
        with c_el2:
            max_k_slider = st.slider("Max K Evaluated", min_value=2, max_value=6, value=5, step=1)

        elbow_cfg = opt_res.config.model_copy(deep=True)
        elbow_cfg.infra_cost_per_warehouse = float(infra_slider)
        tradeoff_data = compute_tradeoff_curve(st.session_state.neighborhoods, elbow_cfg, max_k=max_k_slider)

        pts = tradeoff_data["points"]
        if pts:
            st.success(f"★ **Recommended Optimal K = {tradeoff_data['optimal_K']}** (Total Cost = ${tradeoff_data['min_cost']:,.2f})")
            chart_df = pd.DataFrame([
                {
                    "K": p["K"],
                    "Delivery Cost ($)": p["delivery_cost"],
                    "Infra Cost ($)": p["infra_cost"],
                    "Total Cost ($)": p["total_cost"]
                }
                for p in pts
            ]).set_index("K")
            st.line_chart(chart_df)

    with tab_demand:
        st.markdown("#### Customer Demand Surge & Contraction")
        c_dm1, c_dm2 = st.columns([2, 1])
        with c_dm1:
            shift_slider = st.slider("Demand Change (Δ%)", min_value=-50, max_value=100, value=25, step=5)
        with c_dm2:
            st.markdown("<br>", unsafe_allow_html=True)
            apply_shift_btn = st.button("Apply Shift & Re-Optimize")

        shifted_nodes, shift_stats = simulate_demand_shift(st.session_state.neighborhoods, shift_slider)
        c_s1, c_s2 = st.columns(2)
        c_s1.metric("Original Volume", f"{shift_stats['original_total_orders']:,} orders")
        c_s2.metric("Projected Volume", f"{shift_stats['new_total_orders']:,} orders", f"{shift_stats['net_order_change']:+d}")

        if apply_shift_btn:
            st.session_state.neighborhoods = shifted_nodes
            st.session_state.opt_result = run_optimization(shifted_nodes, opt_res.config)
            st.rerun()

    with tab_fleet:
        st.markdown("#### Congestion & Vehicle Fleet Metrics")
        c_fl1, c_fl2 = st.columns(2)
        with c_fl1:
            traffic_slider = st.slider("Rush-Hour Delay Factor", min_value=0.0, max_value=1.0, value=0.3, step=0.05, format="%.2f")
        with c_fl2:
            vehicle_sel = st.selectbox("Vehicle Type", ["Delivery Van", "Cargo E-Bike", "Heavy Truck"])

        fleet_cfg = opt_res.config.model_copy(deep=True)
        fleet_cfg.traffic_factor = traffic_slider
        fleet_eta_data = calculate_fleet_eta(opt_res.assignments, fleet_cfg, vehicle_sel)

        c_e1, c_e2, c_e3 = st.columns(3)
        c_e1.metric("Average ETA / Drop", f"{fleet_eta_data['avg_eta_minutes']} min", f"Max {fleet_eta_data['max_eta_minutes']} min")
        c_e2.metric("Dispatched Trips", f"{fleet_eta_data['total_trips']} trips")
        c_e3.metric("Est. Fuel Consumption", f"{fleet_eta_data['fuel_consumed_liters']} L", f"{fleet_eta_data['effective_km']} km route")

    with tab_diag:
        st.markdown("#### Facility Capacity & Radius Compliance Audit")
        diag_res = diagnose_constraints(opt_res.warehouses, opt_res.assignments, opt_res.config)
        if diag_res["is_compliant"]:
            st.success("✅ **100% Compliant**: All warehouse capacities and radius limits are strictly satisfied.")
        else:
            st.error(f"⚠️ **{diag_res['total_violations']} Violations Detected**")
            if diag_res["capacity_violations"]:
                st.markdown("**Capacity Overflows:**")
                st.dataframe(pd.DataFrame(diag_res["capacity_violations"]))
            if diag_res["radius_violations"]:
                st.markdown("**Service Radius Breaches:**")
                st.dataframe(pd.DataFrame(diag_res["radius_violations"]))


