"""Tests for TomTom traffic provider + history-aware optimization (no network)."""
import pytest
from fastapi.testclient import TestClient

from src import traffic
from src.cost import corridor_congestion, effective_distance
from src.schema import Assignment, OptimizationConfig


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch, tmp_path):
    monkeypatch.delenv("TOMTOM_KEY", raising=False)
    monkeypatch.setenv("TRAFFIC_HISTORY_PATH", str(tmp_path / "hist.json"))
    traffic.clear_flow_cache()
    traffic.clear_history()
    yield
    traffic.clear_flow_cache()
    traffic.clear_history()


def test_flow_keyless_reports_offline():
    info = traffic.get_flow(12.97, 77.59)
    assert info["live"] is False
    assert info["delay_ratio"] == 0.0


def test_delay_math_from_segment():
    delay, detail = traffic.delay_from_segment(
        {"currentSpeed": 20, "freeFlowSpeed": 40, "confidence": 0.9})
    assert delay == pytest.approx(1.0)
    assert detail["current_speed_kmph"] == 20.0
    delay2, _ = traffic.delay_from_segment(
        {"currentTravelTime": 120, "freeFlowTravelTime": 100})
    assert delay2 == pytest.approx(0.2)
    delay3, _ = traffic.delay_from_segment({})
    assert delay3 == 0.0


def test_live_path_with_mocked_fetch(monkeypatch):
    monkeypatch.setenv("TOMTOM_KEY", "k")
    monkeypatch.setattr(traffic, "_fetch_flow", lambda lat, lon: {
        "currentSpeed": 30, "freeFlowSpeed": 60, "confidence": 0.8})
    info = traffic.get_flow(12.97, 77.59)
    assert info["live"] is True
    assert info["delay_ratio"] == pytest.approx(1.0)
    # TTL cache: second call must not refetch
    calls = []
    monkeypatch.setattr(traffic, "_fetch_flow",
                        lambda lat, lon: calls.append((lat, lon)) or {})
    traffic.get_flow(12.97, 77.59)
    assert calls == []


def test_history_record_and_lookup():
    traffic.record_observation(12.97, 77.59, 0.5, hour=9)
    traffic.record_observation(12.97, 77.59, 0.7, hour=9)
    factor, samples = traffic.historical_factor(12.97, 77.59, hour=9)
    assert factor == pytest.approx(0.6)
    assert samples == 2
    # other hour falls back to all-hours mean
    factor2, samples2 = traffic.historical_factor(12.97, 77.59, hour=3)
    assert factor2 == pytest.approx(0.6) and samples2 == 2
    # unknown cell
    factor3, samples3 = traffic.historical_factor(0.0, 0.0, hour=9)
    assert factor3 == 0.0 and samples3 == 0


def test_corridor_factor_blend_and_floor(monkeypatch):
    # live reading wins, manual floor respected
    monkeypatch.setenv("TOMTOM_KEY", "k")
    monkeypatch.setattr(traffic, "_fetch_flow", lambda lat, lon: {
        "currentSpeed": 40, "freeFlowSpeed": 50, "confidence": 1.0})
    cf = traffic.corridor_factor(12.97, 77.59, manual_floor=0.1, hour=9)
    assert cf["live"] is True
    assert cf["factor"] == pytest.approx(0.25)
    assert cf["samples"] == 0
    # recorded to history
    factor, samples = traffic.historical_factor(12.97, 77.59, hour=9)
    assert samples == 1
    # offline (keyless AND unreachable): history used, manual floor wins when higher
    # (clear the TTL flow cache so the stale live reading doesn't mask the fallback)
    monkeypatch.delenv("TOMTOM_KEY")
    monkeypatch.setattr(traffic, "_fetch_flow", lambda lat, lon: None)
    traffic.clear_flow_cache()
    cf2 = traffic.corridor_factor(12.97, 77.59, manual_floor=0.9, hour=9)
    assert cf2["live"] is False and cf2["factor"] == pytest.approx(0.9)
    # allow_live=False never touches network even with key
    monkeypatch.setenv("TOMTOM_KEY", "k")
    calls = []
    monkeypatch.setattr(traffic, "_fetch_flow",
                        lambda lat, lon: calls.append(1) or {"currentSpeed": 1, "freeFlowSpeed": 50})
    cf3 = traffic.corridor_factor(12.97, 77.59, manual_floor=0.0, hour=9, allow_live=False)
    assert calls == [] and cf3["live"] is False
    assert cf3["factor"] == pytest.approx(0.25)  # recorded history reused


def test_cost_uses_corridor_override():
    cfg = OptimizationConfig(cost_per_km=2.0, traffic_factor=0.1)
    assert effective_distance(10.0, cfg) == pytest.approx(11.0)
    assert effective_distance(10.0, cfg, congestion=0.5) == pytest.approx(15.0)
    assert corridor_congestion(cfg, None) == 0.1


def test_optimize_records_congestion_and_note(monkeypatch):
    from src.optimization import run_optimization
    monkeypatch.setenv("TOMTOM_KEY", "k")
    monkeypatch.setattr(traffic, "_fetch_flow", lambda lat, lon: {
        "currentSpeed": 30, "freeFlowSpeed": 60, "confidence": 1.0})
    nodes = [
        {"neighborhood_id": "N1", "latitude": 17.38, "longitude": 78.48, "daily_orders": 10},
        {"neighborhood_id": "N2", "latitude": 17.40, "longitude": 78.50, "daily_orders": 20},
    ]
    cfg = OptimizationConfig(K=1, use_live_traffic=True)
    res = run_optimization(nodes, cfg)
    assert all(a.congestion_pct is not None for a in res.assignments)
    assert res.metrics.avg_congestion_pct > 0
    assert res.traffic_note and "Live TomTom" in res.traffic_note
    # history learned
    _, samples = traffic.historical_factor(
        res.warehouses[0].latitude, res.warehouses[0].longitude)
    assert samples >= 1


def test_optimize_history_only_no_key():
    from src.optimization import run_optimization
    # history cell must match the warehouse cell the optimizer converges to
    traffic.record_observation(17.40, 78.50, 0.4, hour=12)
    nodes = [
        {"neighborhood_id": "N1", "latitude": 17.38, "longitude": 78.48, "daily_orders": 10},
        {"neighborhood_id": "N2", "latitude": 17.40, "longitude": 78.50, "daily_orders": 20},
    ]
    cfg = OptimizationConfig(K=1, use_live_traffic=True, traffic_hour=12)
    res = run_optimization(nodes, cfg)
    assert res.traffic_note and "History-based" in res.traffic_note
    assert res.metrics.avg_congestion_pct > 0


def test_milp_uses_history_multipliers():
    import numpy as np
    from src.optimization import solve_cflp_milp
    traffic.record_observation(17.40, 78.50, 2.0, hour=10)
    coords = np.array([[17.38, 78.48], [17.39, 78.49]])
    weights = np.array([10.0, 10.0])
    cands = np.array([[17.385, 78.485], [17.40, 78.50]])
    feas_plain, _, _, _ = solve_cflp_milp(coords, weights, 1, cands, None, None, 0.0)
    feas_hist, chosen, _, _ = solve_cflp_milp(
        coords, weights, 1, cands, None, None, 0.0,
        col_multipliers=np.array([1.0, 3.0]))
    assert feas_plain and feas_hist
    # penalized congested candidate loses
    assert abs(chosen[0][0] - 17.385) < 1e-6


def test_traffic_api_without_key():
    from src.api import app
    client = TestClient(app)
    r = client.get("/api/traffic/flow", params={"lat": 12.97, "lon": 77.59})
    assert r.status_code == 200
    body = r.json()
    assert body["live"] is False
    assert "key_configured" in body
    assert "d3rZl2" not in r.text
    r2 = client.get("/api/traffic/history", params={"lat": 12.97, "lon": 77.59, "hour": 9})
    assert r2.status_code == 200
    assert r2.json()["samples"] == 0
