"""
Acceptance tests for Phase 2: Location Visualization & Spatial Mapping.
Acceptance criteria:
- Changing K / metric updates UI / configuration state cleanly.
- Map bounds calculations center dataset accurately.
- 1,000 nodes bounding and bubble scaling processing finishes under 2.0s (Phase 2 acceptance check).
- Config validation flags infeasible configurations (K > N, total capacity < total demand).
"""
import time
from pathlib import Path
from src.data_ingestion import parse_csv_content
from src.mapping import compute_map_bounds, prepare_map_layer_data
from src.schema import OptimizationConfig
from src.validation import validate_optimization_config

SAMPLES_DIR = Path(__file__).resolve().parent.parent.parent / "data" / "samples"


def test_phase2_acceptance_1000_nodes_rendering_speed():
    csv_path = SAMPLES_DIR / "large_1000_nodes.csv"
    with open(csv_path, "r") as f:
        content = f.read()

    _, nodes = parse_csv_content(content)
    assert len(nodes) == 1000

    start_time = time.time()
    layer_data = prepare_map_layer_data(nodes)
    duration = time.time() - start_time

    assert layer_data["total_nodes"] == 1000
    assert "bounds_info" in layer_data
    # Target in phases.md is < 2.0s; usually completes in < 0.05s
    assert duration < 2.0, f"Map processing took {duration:.3f}s, exceeding 2.0s threshold"


def test_phase2_config_validation_k_and_metrics():
    sample_nodes = [
        {"neighborhood_id": "N1", "latitude": 17.38, "longitude": 78.48, "daily_orders": 100},
        {"neighborhood_id": "N2", "latitude": 17.40, "longitude": 78.50, "daily_orders": 200},
        {"neighborhood_id": "N3", "latitude": 17.42, "longitude": 78.45, "daily_orders": 300},
    ]

    # Valid config with K=2 and Haversine
    valid_cfg = OptimizationConfig(K=2, distance_metric="haversine")
    is_valid, errors, _ = validate_optimization_config(valid_cfg, sample_nodes)
    assert is_valid is True
    assert len(errors) == 0

    # Infeasible: K > N
    excess_k_cfg = OptimizationConfig(K=5, distance_metric="euclidean")
    is_valid, errors, _ = validate_optimization_config(excess_k_cfg, sample_nodes)
    assert is_valid is False
    assert any(e.code == "K_EXCEEDS_NODES" for e in errors)

    # Infeasible: K * C_max < total demand (total demand = 600, K=2, C_max=200 -> total cap=400)
    tight_cap_cfg = OptimizationConfig(K=2, capacity_enabled=True, C_max=200)
    is_valid, errors, _ = validate_optimization_config(tight_cap_cfg, sample_nodes)
    assert is_valid is False
    assert any(e.code == "TOTAL_CAPACITY_INSUFFICIENT" for e in errors)
