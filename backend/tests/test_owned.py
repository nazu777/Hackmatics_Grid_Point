"""Tests for owned-warehouse anchoring + fleet assignment."""
import numpy as np
from fastapi.testclient import TestClient
from src.api import app
from src.optimization import (
    allocate_fleet,
    mark_owned_sites,
    owned_site_coords,
    run_optimization,
    weighted_kmeans_optimization,
)
from src.schema import OptimizationConfig

client = TestClient(app)

NBS = [
    {"neighborhood_id": f"A{i}", "name": f"A{i}", "latitude": 17.385 + 0.001 * (i - 1),
     "longitude": 78.485 + 0.001 * (i - 2), "daily_orders": 100}
    for i in range(4)
] + [
    {"neighborhood_id": f"B{i}", "name": f"B{i}", "latitude": 17.445 + 0.001 * (i - 1),
     "longitude": 78.545 + 0.001 * (i - 2), "daily_orders": 100}
    for i in range(4)
]
OWNED = [
    {"warehouse_id": "OWN-A", "latitude": 17.385, "longitude": 78.485},
    {"warehouse_id": "OWN-B", "latitude": 17.445, "longitude": 78.545},
]
FLEET = [
    {"vehicle_type": "truck", "capacity": 200, "cost_per_km": 2.0},
    {"vehicle_type": "van", "capacity": 100, "cost_per_km": 1.2},
    {"vehicle_type": "bike", "capacity": 20, "cost_per_km": 0.4},
]


def test_owned_site_coords_filters_invalid():
    cfg = OptimizationConfig.model_construct(
        owned_warehouses=[{"warehouse_id": "A", "latitude": 10.0, "longitude": 20.0},
                          {"warehouse_id": "B", "latitude": 999.0, "longitude": 20.0}])
    pts = owned_site_coords(cfg)
    assert pts is not None and len(pts) == 1
    assert owned_site_coords(OptimizationConfig()) is None


def test_kmeans_owned_seed_competes():
    coords = np.array([[17.385, 78.485]] * 6 + [[17.445, 78.545]] * 6)
    weights = np.ones(12)
    centers, _ = weighted_kmeans_optimization(
        coords, weights, K=2, random_seed=7,
        initial_centers=np.array([[17.385, 78.485], [17.445, 78.545]]))
    got = sorted([tuple(round(float(v), 3) for v in row) for row in centers])
    assert got == [(17.385, 78.485), (17.445, 78.545)]


def test_optimization_keeps_owned_and_baselines_them():
    cfg = OptimizationConfig(K=2, owned_warehouses=OWNED, vehicle_fleet=FLEET)
    res = run_optimization(NBS, cfg)
    # Result sites snap to the owned sites (kept, flagged).
    assert all(w.is_owned for w in res.warehouses)
    assert all(m.is_owned for m in res.metrics.warehouses)
    # Baseline compares against the owned network (2 custom sites).
    assert len(res.comparison.baseline.warehouses) == 2
    # Whole fleet assigned exactly once, by load share.
    assert len(res.fleet_assignment) == 3
    assert sorted(a.vehicle_id for a in res.fleet_assignment) == ["V1", "V2", "V3"]
    assert {a.warehouse_id for a in res.fleet_assignment} <= {w.warehouse_id for w in res.warehouses}
    assert (sum(len(m.assigned_vehicles) for m in res.metrics.warehouses)
            == len(res.fleet_assignment) == 3)


def test_respect_owned_off_restores_default_behavior():
    cfg = OptimizationConfig(K=2, owned_warehouses=OWNED, respect_owned=False,
                             vehicle_fleet=FLEET)
    res = run_optimization(NBS, cfg)
    assert res.comparison is not None
    # Default centroid baseline = single site.
    assert len(res.comparison.baseline.warehouses) == 1
    assert len(res.fleet_assignment) == 3  # fleet still assigned


def test_allocate_fleet_load_share_and_empty():
    fa, by = allocate_fleet(
        [{"vehicle_type": "t"}, {"vehicle_type": "v"}, {"vehicle_type": "b"}],
        [300, 100], ["W1", "W2"])
    assert [a.warehouse_id for a in fa].count("W1") == 2
    assert [a.warehouse_id for a in fa].count("W2") == 1
    assert by["W1"] == ["V1", "V2"] and by["W2"] == ["V3"]
    fa2, by2 = allocate_fleet([], [10], ["W1"])
    assert fa2 == [] and by2 == {"W1": []}


def test_mark_owned_sites_tolerance():
    from src.schema import Warehouse, Metrics
    whs = [Warehouse(warehouse_id="W1", latitude=17.3851, longitude=78.4851),
           Warehouse(warehouse_id="W2", latitude=18.0, longitude=79.0)]
    from src.schema import WarehouseMetric
    mets = Metrics(total_unweighted_distance_km=0, total_weighted_distance_km_orders=0,
                   total_cost=0, avg_distance_per_order_km=0, avg_weighted_distance_km=0,
                   warehouses=[WarehouseMetric(warehouse_id="W1"),
                               WarehouseMetric(warehouse_id="W2")],
                   infeasible_assignments=0, feasibility_ratio=1.0)
    mark_owned_sites(whs, mets, np.array([[17.385, 78.485]]))
    assert whs[0].is_owned is True and whs[1].is_owned is False
    assert mets.warehouses[0].is_owned is True


def test_optimize_endpoint_with_owned():
    r = client.post("/api/optimize", json={
        "neighborhoods": NBS,
        "config": {"K": 2, "owned_warehouses": OWNED,
                   "vehicle_fleet": FLEET}})
    assert r.status_code == 200, r.text
    body = r.json()
    assert len(body["fleet_assignment"]) == 3
    assert all(w["is_owned"] for w in body["warehouses"])
