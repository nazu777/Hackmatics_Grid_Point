"""
Phase F tests: realtime simulation tick (demand wave + spillover with
threshold/hysteresis) and the Overview aggregate contract (schema.md §2.9).
"""
from fastapi.testclient import TestClient

from src.api import app
from src.schema import Assignment, OptimizationConfig, Warehouse
from src.simulation import (
    build_overview,
    demand_multiplier_for_tick,
    scale_demand_for_tick,
    spillover_reassign,
)

client = TestClient(app)


def _hoods():
    return [
        {"neighborhood_id": "N1", "latitude": 17.38, "longitude": 78.48, "daily_orders": 100},
        {"neighborhood_id": "N2", "latitude": 17.39, "longitude": 78.49, "daily_orders": 100},
        {"neighborhood_id": "N3", "latitude": 17.60, "longitude": 78.70, "daily_orders": 100},
        {"neighborhood_id": "N4", "latitude": 17.61, "longitude": 78.71, "daily_orders": 100},
    ]


def _whs():
    return [
        Warehouse(warehouse_id="W1", latitude=17.385, longitude=78.485),
        Warehouse(warehouse_id="W2", latitude=17.605, longitude=78.705),
    ]


def _assignments():
    return [
        Assignment(neighborhood_id="N1", warehouse_id="W1", distance_km=1.0,
                   weighted_distance=100.0, cost=100.0, fuel_cost=5.0,
                   within_radius=True, is_feasible=True),
        Assignment(neighborhood_id="N2", warehouse_id="W1", distance_km=1.5,
                   weighted_distance=150.0, cost=150.0, fuel_cost=7.0,
                   within_radius=True, is_feasible=True),
        Assignment(neighborhood_id="N3", warehouse_id="W2", distance_km=1.0,
                   weighted_distance=100.0, cost=100.0, fuel_cost=5.0,
                   within_radius=True, is_feasible=True),
        Assignment(neighborhood_id="N4", warehouse_id="W2", distance_km=1.2,
                   weighted_distance=120.0, cost=120.0, fuel_cost=6.0,
                   within_radius=True, is_feasible=True),
    ]


def test_demand_wave_is_deterministic_and_varies_by_tick():
    n = _hoods()
    s1, _ = scale_demand_for_tick(n, tick=3)
    s1b, _ = scale_demand_for_tick(n, tick=3)
    s2, _ = scale_demand_for_tick(n, tick=4)
    assert [x["daily_orders"] for x in s1] == [x["daily_orders"] for x in s1b]
    # wave moves between ticks (global multiplier differs)
    assert demand_multiplier_for_tick(3) != demand_multiplier_for_tick(4)
    assert all(x["daily_orders"] >= 1 for x in s1)


def test_spillover_starts_and_recovers_with_hysteresis():
    cfg = OptimizationConfig(K=2, simulation_congestion_threshold=0.5,
                             simulation_hysteresis=0.15)
    # Start: W1 congested -> N1,N2 spill to W2
    out, spills, events = spillover_reassign(
        _hoods(), _whs(), _assignments(),
        {"W1": 0.85, "W2": 0.05}, cfg, {}, tick=3)
    assert len(events) == 1 and events[0].kind == "spill_start"
    assert events[0].warehouse_id == "W1"
    assert set(events[0].moved_neighborhood_ids) == {"N1", "N2"}
    assert all(a.warehouse_id == "W2" for a in out if a.neighborhood_id in ("N1", "N2"))
    # Hysteresis band: 0.4 is below threshold but above 0.35 -> no recovery
    out2, spills2, events2 = spillover_reassign(
        _hoods(), _whs(), out, {"W1": 0.40, "W2": 0.05}, cfg, spills, tick=4)
    assert events2 == [] and "W1" in spills2
    # Cleared: 0.2 <= 0.35 -> spill ends, nodes come home
    out3, spills3, events3 = spillover_reassign(
        _hoods(), _whs(), out2, {"W1": 0.20, "W2": 0.05}, cfg, spills2, tick=5)
    assert len(events3) == 1 and events3[0].kind == "spill_end"
    assert "W1" not in spills3
    assert all(a.warehouse_id == "W1" for a in out3 if a.neighborhood_id in ("N1", "N2"))


def test_tick_endpoint_spills_and_overview_reconciles():
    cfg = {"K": 2, "simulation_mode": "realtime",
           "simulation_congestion_threshold": 0.5, "simulation_hysteresis": 0.15}
    body = {"neighborhoods": _hoods(),
            "warehouses": [w.model_dump() for w in _whs()],
            "assignments": [a.model_dump() for a in _assignments()],
            "config": cfg, "tick": 3,
            "congestion_overrides": {"W1": 0.9, "W2": 0.0},
            "simulate_surge": False}
    r = client.post("/api/simulation/tick", json=body)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["events"] and data["events"][0]["kind"] == "spill_start"
    assert data["congestion_by_warehouse"]["W1"] == 0.9
    assert data["metrics"]["total_fuel_cost"] >= 0
    # Recovery tick: overrides cleared -> spill ends
    body2 = {**body, "tick": 4, "active_spills": data["active_spills"],
             "assignments": data["assignments"],
             "congestion_overrides": {"W1": 0.1, "W2": 0.0}}
    r2 = client.post("/api/simulation/tick", json=body2)
    assert r2.status_code == 200, r2.text
    assert r2.json()["events"][0]["kind"] == "spill_end"


def test_overview_endpoint_populates_all_phase14_fields():
    body = {"neighborhoods": _hoods(),
            "warehouses": [w.model_dump() for w in _whs()],
            "assignments": [a.model_dump() for a in _assignments()],
            "config": {"K": 2, "cost_per_km": 1.0,
                       "vehicle_fleet": [{"vehicle_type": "van", "capacity": 120,
                                          "cost_per_km": 1.2, "fuel_type": "diesel",
                                          "avg_speed_kmph": 40.0, "mileage_kmpl": 12.0}],
                       "infra_cost_per_warehouse": 500.0}}
    r = client.post("/api/overview", json=body)
    assert r.status_code == 200, r.text
    ov = r.json()
    assert ov["vehicle_count"] == 1 and ov["vehicle_mix"] == {"van": 1}
    assert ov["warehouse_count"] == 2
    assert ov["order_totals"] == {"nodes": 4, "daily_orders": 400}
    assert ov["infra_price"] == {"per_warehouse": 500.0, "total": 1000.0}
    for key in ("total_cost", "total_fuel_cost", "avg_congestion_pct",
                "feasibility_ratio", "avg_distance_per_order_km"):
        assert key in ov["distance_cost"], key
    assert isinstance(ov["alerts"], list)


def test_live_snapshot_shape():
    r = client.post("/api/simulation/live", json={
        "neighborhoods": _hoods(),
        "warehouses": [w.model_dump() for w in _whs()],
        "config": {"K": 2, "use_live_fuel": True}})
    assert r.status_code == 200, r.text
    snap = r.json()
    assert set(("fuel", "traffic", "demand")) <= set(snap.keys())
    assert "prices" in snap["fuel"] and "by_warehouse" in snap["traffic"]


def test_build_overview_alerts_spillover_and_overcapacity():
    cfg = OptimizationConfig(K=2)
    whs = [Warehouse(warehouse_id="W1", latitude=17.38, longitude=78.48,
                     assigned_orders=1300, utilization_pct=100.0)]
    ov = build_overview(_hoods()[:1], whs, _assignments()[:1], cfg,
                        active_spills={"W1": {}})
    assert any("spillover" in a for a in ov["alerts"])
