"""
Follow-up phases G–L tests: zone traffic (L), sim-live tick extras (I),
seed summaries (G). Contracts: docs/followup_phases.md §1.3–§1.4.
"""
from fastapi.testclient import TestClient

from src.api import app
from src.census import seed_summary as census_seed_summary
from src.simulation import tick_extras
from src.synthetic import seed_summary as synthetic_seed_summary
from src.traffic import (
    build_traffic_zones,
    zone_factor,
    zone_intensity_at,
)
from src.schema import Assignment, OptimizationConfig, Warehouse

client = TestClient(app)


def _hoods():
    return [
        {"neighborhood_id": "N1", "latitude": 17.38, "longitude": 78.48, "daily_orders": 100},
        {"neighborhood_id": "N2", "latitude": 17.39, "longitude": 78.49, "daily_orders": 50},
        {"neighborhood_id": "N3", "latitude": 17.60, "longitude": 78.70, "daily_orders": 25},
    ]


def test_zone_intensity_centre_high_edge_low():
    hoods = _hoods()
    center = (sum(n["latitude"] for n in hoods) / 3, sum(n["longitude"] for n in hoods) / 3)
    near = zone_intensity_at(center[0], center[1], center, tick=0)
    far = zone_intensity_at(center[0] + 0.5, center[1] + 0.5, center, tick=0)
    assert 0.0 <= far <= near <= 1.0
    assert near > 0.5  # centre-high


def test_zone_factor_fallback_empty():
    # L-late safety: works with no data (I must work standalone).
    assert 0.0 <= zone_factor(17.38, 78.48, [], tick=0) <= 1.0
    assert 0.0 <= zone_factor(17.38, 78.48, None, tick=5) <= 1.0  # type: ignore[arg-type]


def test_build_traffic_zones_contract():
    res = build_traffic_zones(_hoods(), rings=2, segments=4, tick=3)
    assert len(res["zones"]) == 8
    for z in res["zones"]:
        assert set(z) >= {"zone_id", "name", "intensity", "level", "polygon"}
        assert 0.0 <= z["intensity"] <= 1.0
        assert z["level"] in ("low", "medium", "high")
        assert len(z["polygon"]) >= 4
        assert all(len(p) == 2 for p in z["polygon"])
    assert res["live"] is False  # no TOMTOM_KEY in tests
    # Intensities shift across ticks (realtime requirement).
    res2 = build_traffic_zones(_hoods(), rings=2, segments=4, tick=4)
    assert [z["intensity"] for z in res["zones"]] != [z["intensity"] for z in res2["zones"]]


def test_traffic_zones_endpoint():
    r = client.post("/api/traffic/zones", json={"neighborhoods": _hoods(), "tick": 3})
    assert r.status_code == 200
    body = r.json()
    assert isinstance(body["zones"], list) and len(body["zones"]) > 0
    assert body["zones"][0]["level"] in ("low", "medium", "high")
    r2 = client.get("/api/traffic/zones?tick=3")
    assert r2.status_code == 200
    assert r2.json()["zones"] == []


def test_tick_extras_order_moves_and_capacity():
    hoods = _hoods()
    whs = [Warehouse(warehouse_id="W1", latitude=17.385, longitude=78.485),
           Warehouse(warehouse_id="W2", latitude=17.605, longitude=78.705)]
    cfg = OptimizationConfig()
    before = [
        Assignment(neighborhood_id="N1", warehouse_id="W1", distance_km=1.0,
                   weighted_distance=100.0, cost=100.0, within_radius=True, is_feasible=True),
        Assignment(neighborhood_id="N2", warehouse_id="W1", distance_km=1.5,
                   weighted_distance=75.0, cost=75.0, within_radius=True, is_feasible=True),
    ]
    after = [
        Assignment(neighborhood_id="N1", warehouse_id="W2", distance_km=2.0,
                   weighted_distance=200.0, cost=200.0, within_radius=True, is_feasible=True),
        Assignment(neighborhood_id="N2", warehouse_id="W1", distance_km=1.5,
                   weighted_distance=75.0, cost=75.0, within_radius=True, is_feasible=True),
    ]
    extras = tick_extras(hoods, whs, before, after, {"W1": 0.9, "W2": 0.1}, cfg, tick=3)
    assert extras["order_moves"] == [
        {"order_id": "N1", "from_warehouse": "W1", "to_warehouse": "W2"}]
    assert extras["capacity_updates"]["W1"]["assigned_orders"] == 50
    assert extras["capacity_updates"]["W2"]["assigned_orders"] == 100
    assert "prices" in extras["fuel_snapshot"]
    assert set(extras["zone_intensities"]) == {"W1", "W2"}


def test_tick_endpoint_carries_extras():
    hoods = _hoods()
    whs = [{"warehouse_id": "W1", "latitude": 17.385, "longitude": 78.485},
           {"warehouse_id": "W2", "latitude": 17.605, "longitude": 78.705}]
    asgs = [
        {"neighborhood_id": "N1", "warehouse_id": "W1", "distance_km": 1.0,
         "weighted_distance": 100.0, "cost": 100.0, "within_radius": True, "is_feasible": True},
        {"neighborhood_id": "N2", "warehouse_id": "W1", "distance_km": 1.5,
         "weighted_distance": 75.0, "cost": 75.0, "within_radius": True, "is_feasible": True},
        {"neighborhood_id": "N3", "warehouse_id": "W2", "distance_km": 1.0,
         "weighted_distance": 25.0, "cost": 25.0, "within_radius": True, "is_feasible": True},
    ]
    r = client.post("/api/simulation/tick", json={
        "neighborhoods": hoods, "warehouses": whs, "assignments": asgs,
        "config": {"simulation_mode": "realtime"}, "tick": 3,
        "congestion_overrides": {"W1": 0.9}})
    assert r.status_code == 200
    body = r.json()
    assert body["order_moves"]  # W1 spill moves nodes
    assert body["order_moves"][0]["from_warehouse"] == "W1"
    assert "W1" in body["capacity_updates"]
    assert "prices" in body["fuel_snapshot"]
    assert "W1" in body["zone_intensities"]


def test_seed_summaries_exact_counts():
    hoods = _hoods()
    s = synthetic_seed_summary(
        hoods,
        [{"vehicle_type": "van"}, {"vehicle_type": "truck"}],
        [{"warehouse_id": "EX-W1"}])
    assert s == {"nodes": 3, "total_orders": 175, "warehouses": 1, "vehicles": 2,
                 "zones": {"Unzoned": 3}}
    c = census_seed_summary(hoods)
    assert c["nodes"] == 3 and c["total_orders"] == 175
