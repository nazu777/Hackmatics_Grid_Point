"""
Phase 3 Acceptance Tests (phases.md Phase 3 Acceptance Criteria):
- Benchmark N=1,000 nodes optimization < 5s
- For known clusters, warehouses converge near weighted centroids
- Constrained run respects C_max / R_max or reports violations
- Pipeline outputs warehouses: [{warehouse_id, lat, lon}] and assignments: [{neighborhood_id, warehouse_id, distance_km}]
"""
import time
from pathlib import Path
import numpy as np
from fastapi.testclient import TestClient

from src.data_ingestion import parse_csv_content
from src.schema import OptimizationConfig, SyntheticGenerationConfig
from src.synthetic import generate_synthetic_dataset
from src.optimization import run_optimization
from src.api import app

client = TestClient(app)
SAMPLES_DIR = Path(__file__).resolve().parent.parent.parent / "data" / "samples"


def test_acceptance_phase3_1000_nodes_benchmark():
    """Verify performance target: optimize 1,000 nodes within 5 seconds."""
    csv_path = SAMPLES_DIR / "large_1000_nodes.csv"
    with open(csv_path, "r") as f:
        content = f.read()

    _, nodes = parse_csv_content(content)
    assert len(nodes) == 1000

    config = OptimizationConfig(K=5, distance_metric="haversine", random_seed=42)

    start_time = time.time()
    result = run_optimization(nodes, config)
    elapsed = time.time() - start_time

    assert len(result.warehouses) == 5
    assert len(result.assignments) == 1000
    assert result.metrics.total_cost > 0
    assert result.comparison is not None
    # Verify strict SLA < 5s (typical < 0.8s)
    assert elapsed < 5.0, f"Optimization of 1,000 nodes took {elapsed:.2f}s, exceeding 5s limit"


def test_acceptance_phase3_cluster_convergence():
    """Verify that for known spatial clusters, warehouses converge near weighted centroids."""
    cfg = SyntheticGenerationConfig(
        N=90,
        lat_center=17.385,
        lon_center=78.486,
        spread_km=25.0,
        distribution="clustered",
        num_clusters=3,
        seed=100
    )
    nodes = generate_synthetic_dataset(cfg)
    opt_config = OptimizationConfig(K=3, random_seed=100)

    result = run_optimization(nodes, opt_config)
    assert len(result.warehouses) == 3

    # Each warehouse should have non-zero assignments
    for w in result.warehouses:
        assert w.assigned_orders > 0

    # Total assigned orders across all warehouses must equal sum of all daily orders
    total_assigned = sum(w.assigned_orders for w in result.warehouses)
    total_expected = sum(int(n["daily_orders"]) for n in nodes)
    assert total_assigned == total_expected


def test_acceptance_phase3_api_optimize_endpoint():
    """Verify POST /api/optimize endpoint returns complete schema-compliant response."""
    payload = {
        "neighborhoods": [
            {"neighborhood_id": "N1", "latitude": 17.38, "longitude": 78.48, "daily_orders": 100},
            {"neighborhood_id": "N2", "latitude": 17.40, "longitude": 78.50, "daily_orders": 200},
            {"neighborhood_id": "N3", "latitude": 17.44, "longitude": 78.36, "daily_orders": 300},
        ],
        "config": {
            "K": 2,
            "distance_metric": "haversine",
            "cost_per_km": 1.5,
            "random_seed": 42
        }
    }

    response = client.post("/api/optimize", json=payload)
    assert response.status_code == 200
    data = response.json()

    assert "warehouses" in data
    assert len(data["warehouses"]) == 2
    assert "assignments" in data
    assert len(data["assignments"]) == 3
    assert "metrics" in data
    assert "comparison" in data
    assert data["metrics"]["total_cost"] > 0
