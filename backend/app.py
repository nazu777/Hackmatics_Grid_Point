"""
GridPoint — Warehouse Location & Assignment Optimization Platform
Phase 1: Data Ingestion & Setup (Streamlit UI)
"""
import streamlit as st
import pandas as pd
import json

from src.schema import SyntheticGenerationConfig
from src.validation import validate_neighborhoods
from src.data_ingestion import (
    parse_csv_content,
    parse_json_content,
    export_to_csv,
    export_to_json,
    compute_dataset_summary
)
from src.synthetic import generate_synthetic_dataset

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

# Title & Pipeline Banner
st.markdown('<div class="main-header">📍 GRIDPOINT</div>', unsafe_allow_html=True)
st.markdown(
    '<div class="sub-header">Warehouse Location & Assignment Optimization Platform &bull; '
    '<strong>Phase 1: Data Ingestion & Validation</strong></div>',
    unsafe_allow_html=True
)

st.info(
    "🔄 **Pipeline Flow**: `Neighborhood Data (Active)` ➔ `Location Visualization (Phase 2)` ➔ "
    "`Warehouse Optimization (Phase 3)` ➔ `Neighborhood Assignment (Phase 3)` ➔ `Delivery Cost Comparison (Phase 4)`"
)

# Sidebar Controls
with st.sidebar:
    st.header("⚙️ Data Source")
    input_mode = st.radio(
        "Choose Ingestion Method:",
        ["🎲 Synthetic Generator", "📁 File Upload (CSV/JSON)", "✏️ Manual Data Table"],
        index=0
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

# Main Ingestion Logic
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
