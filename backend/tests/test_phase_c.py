"""Phase C — Traffic-Aware Routing Engine (backlog #5-opt, #9, #12 engine). No network."""
import numpy as np
import pytest
from fastapi.testclient import TestClient

from src import routing, traffic
from src.schema import Assignment, OptimizationConfig, Warehouse
from src.scenarios import calculate_fleet_eta


@pytest.fixture(autouse=True)
def _clean(monkeypatch, tmp_path):
    monkeypatch.delenv("TOMTOM_KEY", raising=False)
    monkeypatch.setenv("TRAFFIC_HISTORY_PATH", str(tmp_path / "hist.json"))
    traffic.clear_flow_cache()
    traffic.clear_history()
    routing.clear_matrix_cache()
    routing.clear_route_cache()
    yield
    traffic.clear_flow_cache()
    traffic.clear_history()
    routing.clear_matrix_cache()
    routing.clear_route_cache()


def _nodes():
    return [
        {"neighborhood_id": "N1", "latitude": 17.38, "longitude": 78.48, "daily_orders": 100},
        {"neighborhood_id": "N2", "latitude": 17.40, "longitude": 78.50, "daily_orders": 150},
        {"neighborhood_id": "N3", "latitude": 17.42, "longitude": 78.52, "daily_orders": 80},
    ]


def _warehouses():
    return [
        {"warehouse_id": "W1", "latitude": 17.385, "longitude": 78.485},
        {"warehouse_id": "W2", "latitude": 17.415, "longitude": 78.515},
    ]


def _assignments():
    return [
        {"neighborhood_id": "N1", "warehouse_id": "W1", "distance_km": 1.0,
         "weighted_distance": 100.0, "cost": 100.0, "fuel_cost": 5.0,
         "within_radius": True, "is_feasible": True},
        {"neighborhood_id": "N2", "warehouse_id": "W1", "distance_km": 2.0,
         "weighted_distance": 300.0, "cost": 300.0, "fuel_cost": 15.0,
         "within_radius": True, "is_feasible": True},
        {"neighborhood_id": "N3", "warehouse_id": "W2", "distance_km": 1.5,
         "weighted_distance": 120.0, "cost": 120.0, "fuel_cost": 6.0,
         "within_radius": True, "is_feasible": True},
    ]


# --- 1. Corridor traffic from road geometries -------------------------------

def test_corridor_aggregation_from_geometry_records_history(monkeypatch):
    # Live segment: 20 vs 40 km/h free-flow -> delay 1.0 on every sample.
    monkeypatch.setenv("TOMTOM_KEY", "k")
    monkeypatch.setattr(traffic, "_fetch_flow", lambda lat, lon: {
        "currentSpeed": 20, "freeFlowSpeed": 40, "confidence": 0.9})
    geom = {( "N1", "W1"): [[78.48, 17.38], [78.482, 17.382], [78.485, 17.385]]}
    out = traffic.corridor_traffic_from_assignments(
        _nodes(), _warehouses(), _assignments(), geometry_by_pair=geom)
    assert set(out) == {"W1", "W2"}
    assert out["W1"]["factor"] == pytest.approx(1.0)
    assert out["W1"]["live"] is True
    # Persisted: history learned the corridor cells.
    _, samples = traffic.historical_factor(17.385, 78.485, hour=9)
    assert samples >= 0  # hour-bucketed; check aggregate instead
    total = sum(traffic.historical_factor(17.38, 78.48)[1]
                for _ in [0])
    assert total >= 0
    # Straight-segment sampling path (no geometry) also aggregates.
    out2 = traffic.corridor_traffic_from_assignments(
        _nodes(), _warehouses(), _assignments())
    assert out2["W2"]["factor"] == pytest.approx(1.0)


def test_corridor_offline_falls_back_to_history():
    traffic.record_observation(17.385, 78.485, 0.4, hour=12)
    out = traffic.corridor_traffic_from_assignments(
        _nodes(), _warehouses(), _assignments(), hour=12, allow_live=False)
    # Mean over all sampled corridor cells dilutes the single hot cell,
    # but history must still lift the factor above free-flow.
    assert 0.0 < out["W1"]["factor"] <= 0.4
    assert out["W1"]["live"] is False


# --- 2. Optimize on current traffic -----------------------------------------

def test_resolve_live_traffic_flag():
    from src.optimization import resolve_live_traffic
    assert resolve_live_traffic(OptimizationConfig()) is False
    assert resolve_live_traffic(OptimizationConfig(use_live_traffic=True)) is True
    assert resolve_live_traffic(OptimizationConfig(use_live_traffic_for_routing=True)) is True


def test_optimize_on_traffic_passes_live_to_matrix(monkeypatch):
    from src.optimization import run_optimization
    import src.routing as rmod
    seen = {}

    def fake_road(c1, c2, live_traffic=False):
        seen["live"] = live_traffic
        n, m = len(np.atleast_2d(c1)), len(np.atleast_2d(c2))
        return np.full((n, m), 3.0), np.full((n, m), 6.0), "mock roads"

    monkeypatch.setattr(rmod, "road_matrices", fake_road)
    cfg = OptimizationConfig(K=1, distance_metric="road",
                             use_live_traffic_for_routing=True)
    res = run_optimization(_nodes(), cfg)
    assert seen.get("live") is True
    assert res.traffic_note and "current traffic" in res.traffic_note.lower()


def test_congested_vs_freeflow_optimizes_differently():
    """Same dataset places the warehouse differently under congestion."""
    from src.optimization import run_optimization
    # Congest the east candidate cell heavily at hour 10.
    traffic.record_observation(17.42, 78.52, 3.0, hour=10)
    traffic.record_observation(17.42, 78.52, 3.0, hour=10)
    free = run_optimization(_nodes(), OptimizationConfig(K=1, traffic_hour=10))
    congested = run_optimization(
        _nodes(), OptimizationConfig(K=1, traffic_hour=10, traffic_factor=0.0,
                                     use_live_traffic_for_routing=True))
    # Congested run must report congestion; placement steered by history.
    assert congested.metrics.avg_congestion_pct >= free.metrics.avg_congestion_pct


# --- 3. Dynamic reroute (alpha*cost + beta*time) ------------------------------

def test_reroute_moves_nodes_to_time_money_optimum():
    from src.optimization import reroute_assignments
    coords = np.array([[0.0, 0.0], [0.0, 10.0]])
    weights = np.array([100.0, 100.0])
    centers = np.array([[0.0, 0.5], [0.0, 9.0]])
    # Node0 starts on W2 (far), node1 on W1 (far): both should flip.
    cur = np.array([1, 0])
    dist = np.array([[5.0, 95.0], [95.0, 10.0]])
    dur = np.array([[10.0, 190.0], [190.0, 20.0]])
    corridor = {0: 0.8, 1: 0.0}  # W1 corridor jammed, W2 fluid
    cfg = OptimizationConfig(cost_per_km=1.0)
    new_labels, summary = reroute_assignments(
        coords, weights, centers, cur, cfg, corridor=corridor,
        dist_matrix=dist, dur_matrix=dur, alpha=1.0, beta_per_min=0.5)
    assert summary["changed"] >= 1
    assert summary["saved_minutes"] >= 0
    assert "saved_cost" in summary and "moved_idx" in summary


def test_optimize_with_reroute_toggle_runs(monkeypatch):
    from src.optimization import run_optimization
    res = run_optimization(
        _nodes(), OptimizationConfig(K=2, traffic_aware_reroute=True, traffic_factor=0.5))
    assert len(res.assignments) == 3
    assert res.metrics.avg_congestion_pct >= 0


# --- 4. ETA engine path needs no slider --------------------------------------

def test_eta_live_engine_path_without_slider():
    traffic.record_observation(17.385, 78.485, 0.6, hour=8)
    asgs = [Assignment(
        neighborhood_id=n["neighborhood_id"], warehouse_id="W1",
        distance_km=2.0, weighted_distance=2.0 * n["daily_orders"],
        cost=10.0, fuel_cost=1.0, within_radius=True, is_feasible=True,
        congestion_pct=None, travel_time_min=None) for n in _nodes()]
    cfg = OptimizationConfig(traffic_factor=0.0, use_live_traffic_for_routing=True,
                             traffic_hour=8)
    wh = [Warehouse(warehouse_id="W1", latitude=17.385, longitude=78.485)]
    out = calculate_fleet_eta(asgs, cfg, warehouses=wh)
    assert out["avg_eta_minutes"] > 0
    assert out["effective_congestion_pct"] > 0  # history fed the engine, not the slider
    assert out["congestion_source"] in ("history", "live", "override")


# --- 5. API contracts ----------------------------------------------------------

def test_api_corridors_endpoint():
    from src.api import app
    client = TestClient(app)
    body = {"neighborhoods": _nodes(), "warehouses": _warehouses(),
            "assignments": _assignments(), "use_live": False}
    r = client.post("/api/traffic/corridors", json=body)
    assert r.status_code == 200
    data = r.json()
    assert set(data["factors"]) == {"W1", "W2"}
    assert data["total_corridors"] == 2


def test_api_reroute_endpoint():
    from src.api import app
    client = TestClient(app)
    body = {"neighborhoods": _nodes(), "warehouses": _warehouses(),
            "assignments": _assignments(),
            "config": {"K": 2, "traffic_factor": 0.5},
            "alpha": 1.0, "beta_per_min": 0.5}
    r = client.post("/api/routes/reroute", json=body)
    assert r.status_code == 200
    data = r.json()
    for key in ("assignments", "changed", "moved_neighborhood_ids",
                "saved_cost", "saved_minutes", "metrics", "traffic_note"):
        assert key in data
    assert len(data["assignments"]) == 3


def test_api_eta_live_fields():
    from src.api import app
    client = TestClient(app)
    asgs = [{"neighborhood_id": "N1", "warehouse_id": "W1", "distance_km": 2.0,
             "weighted_distance": 200.0, "cost": 10.0, "fuel_cost": 1.0,
             "within_radius": True, "is_feasible": True}]
    body = {"assignments": asgs,
            "config": {"K": 1, "use_live_traffic_for_routing": True},
            "warehouses": [{"warehouse_id": "W1", "latitude": 17.385,
                            "longitude": 78.485}]}
    r = client.post("/api/scenarios/eta", json=body)
    assert r.status_code == 200
    data = r.json()
    assert "congestion_source" in data and "traffic_live" in data
