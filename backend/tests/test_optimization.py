"""Tests for Weiszfeld, Weighted K-Means, and PuLP MILP CFLP solvers."""
import numpy as np
import pytest
from src.schema import OptimizationConfig, Warehouse
from src.optimization import (
    weiszfeld_geometric_median,
    weighted_kmeans_optimization,
    solve_cflp_milp,
    run_optimization
)


def test_weiszfeld_symmetric_equal_weights():
    # 4 symmetric points around (10.0, 10.0) with equal weights
    coords = np.array([
        [9.0, 10.0],
        [11.0, 10.0],
        [10.0, 9.0],
        [10.0, 11.0]
    ])
    weights = np.array([100.0, 100.0, 100.0, 100.0])
    center = weiszfeld_geometric_median(coords, weights)
    # Fermat-Weber center should be (10.0, 10.0)
    assert pytest.approx(center[0], abs=1e-3) == 10.0
    assert pytest.approx(center[1], abs=1e-3) == 10.0


def test_weiszfeld_dominant_weight():
    # Point A has overwhelming weight (10,000 orders) vs minor point B (1 order)
    coords = np.array([
        [17.385, 78.486],
        [17.900, 79.000]
    ])
    weights = np.array([10000.0, 1.0])
    center = weiszfeld_geometric_median(coords, weights)
    # Warehouse should be placed virtually on Point A
    assert pytest.approx(center[0], abs=1e-3) == 17.385
    assert pytest.approx(center[1], abs=1e-3) == 78.486


def test_weighted_kmeans_clusters():
    # Two distinct clusters separated by ~1 degree
    c1 = np.array([[17.0, 78.0], [17.02, 78.01], [17.01, 77.99]])
    c2 = np.array([[18.5, 79.5], [18.51, 79.49], [18.49, 79.52]])
    coords = np.vstack([c1, c2])
    weights = np.array([100, 120, 90, 200, 180, 220])

    centers, labels = weighted_kmeans_optimization(coords, weights, K=2, random_seed=42)
    assert len(centers) == 2
    # Verify each warehouse sits near its cluster
    cluster1_center = np.mean(c1, axis=0)
    cluster2_center = np.mean(c2, axis=0)

    dists_c1 = np.linalg.norm(centers - cluster1_center, axis=1)
    dists_c2 = np.linalg.norm(centers - cluster2_center, axis=1)

    assert min(dists_c1) < 0.1
    assert min(dists_c2) < 0.1


def test_cflp_milp_capacity_satisfaction():
    # 4 neighborhoods with 100 orders each = 400 total
    coords = np.array([
        [17.1, 78.1],
        [17.12, 78.11],
        [17.8, 78.8],
        [17.82, 78.81]
    ])
    weights = np.array([100, 100, 100, 100])
    candidates = np.array([
        [17.11, 78.105],
        [17.81, 78.805]
    ])

    # K=2, C_max=250. Total capacity 500 >= 400
    feasible, chosen, labels, reason = solve_cflp_milp(
        coords=coords,
        weights=weights,
        K=2,
        candidate_centers=candidates,
        C_max=250,
        R_max_km=None,
        infra_cost=0.0
    )
    assert feasible is True
    assert chosen is not None
    assert len(chosen) == 2

    # Check capacity per warehouse
    assigned_w0 = np.sum(weights[labels == 0])
    assigned_w1 = np.sum(weights[labels == 1])
    assert assigned_w0 <= 250
    assert assigned_w1 <= 250


def test_run_optimization_end_to_end():
    neighborhoods = [
        {"neighborhood_id": "N1", "name": "A", "latitude": 17.38, "longitude": 78.48, "daily_orders": 150},
        {"neighborhood_id": "N2", "name": "B", "latitude": 17.40, "longitude": 78.50, "daily_orders": 120},
        {"neighborhood_id": "N3", "name": "C", "latitude": 17.45, "longitude": 78.38, "daily_orders": 200},
        {"neighborhood_id": "N4", "name": "D", "latitude": 17.44, "longitude": 78.35, "daily_orders": 180},
    ]
    config = OptimizationConfig(K=2, random_seed=42, distance_metric="haversine")

    result = run_optimization(neighborhoods, config)

    assert result.is_feasible is True
    assert len(result.warehouses) == 2
    assert len(result.assignments) == 4
    assert result.metrics.total_weighted_distance_km_orders > 0
    assert result.metrics.total_cost > 0
    assert result.comparison is not None
    assert result.comparison.delta.pct_cost_saved >= 0.0
