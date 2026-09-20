"""Tests for live fuel price provider + fuel-aware cost engine (no network)."""
import pytest
from fastapi.testclient import TestClient

from src import fuel
from src.cost import assignment_fuel_cost, compute_metrics, effective_rate, resolve_fuel_prices, split_rate
from src.schema import Assignment, OptimizationConfig, VehicleType, Warehouse


@pytest.fixture(autouse=True)
def _clean_env_and_cache(monkeypatch):
    monkeypatch.delenv("RAPIDAPI_KEY", raising=False)
    fuel.clear_cache()
    yield
    fuel.clear_cache()


def test_fallback_without_key():
    info = fuel.get_state_rates("Karnataka")
    assert info["live"] is False
    assert info["cities"] == []
    assert info["defaults"]["petrol"] > 0


def test_price_for_unknown_fuel():
    price, live, city = fuel.price_for("rocket", state="Karnataka")
    assert price is None


def test_price_for_fallback_defaults():
    price, live, city = fuel.price_for("Petrol", state="Karnataka")
    assert price == fuel.FALLBACK_PRICES["petrol"]
    assert live is False


def test_live_path_with_mocked_fetch(monkeypatch):
    monkeypatch.setenv("RAPIDAPI_KEY", "test-key")
    monkeypatch.setattr(fuel, "_fetch_state", lambda state: [
        {"city": "Bengaluru", "petrol": "110.93", "diesel": "98.8", "cng": "97", "autogas": None},
    ])
    info = fuel.get_state_rates("Karnataka")
    assert info["live"] is True
    assert info["cities"][0]["city"] == "Bengaluru"
    price, live, city = fuel.price_for("petrol", city="bengaluru", state="Karnataka")
    assert price == 110.93 and live is True and city == "Bengaluru"
    # cache hit: second call must not refetch
    calls = []
    monkeypatch.setattr(fuel, "_fetch_state", lambda state: calls.append(state) or [])
    fuel.get_state_rates("Karnataka")
    assert calls == []


def test_fetch_failure_falls_back(monkeypatch):
    monkeypatch.setenv("RAPIDAPI_KEY", "test-key")
    monkeypatch.setattr(fuel, "_fetch_state", lambda state: None)
    info = fuel.get_state_rates("Karnataka")
    assert info["live"] is False


def _fleet_cfg(**kw):
    base = dict(
        vehicle_fleet=[
            VehicleType(vehicle_type="van", capacity=100, cost_per_km=2.0,
                        fuel_type="diesel", mileage_kmpl=12.0),
        ]
    )
    base.update(kw)
    return OptimizationConfig(**base)


def test_split_rate_manual_backwards_compat():
    cfg = OptimizationConfig(cost_per_km=2.0, fuel_cost_per_km=0.5)
    base, fuel_part = split_rate(cfg)
    assert base == 2.0 and fuel_part == 0.5
    assert effective_rate(cfg) == 2.5


def test_split_rate_live_fleet_burn(monkeypatch):
    monkeypatch.setenv("RAPIDAPI_KEY", "k")
    monkeypatch.setattr(fuel, "_fetch_state", lambda state: [
        {"city": "Bengaluru", "petrol": "110.93", "diesel": "98.8", "cng": "97", "autogas": None},
    ])
    cfg = _fleet_cfg(use_live_fuel=True, fuel_state="Karnataka", fuel_city="Bengaluru")
    base, fuel_part = split_rate(cfg)
    assert base == 2.0
    assert fuel_part == pytest.approx(98.8 / 12.0)
    assert assignment_fuel_cost(10, 5.0, cfg) == pytest.approx(10 * 5.0 * (98.8 / 12.0))


def test_compute_metrics_tracks_fuel():
    cfg = _fleet_cfg(cost_per_km=1.0, fuel_cost_per_km=0.5)
    nodes = [
        {"neighborhood_id": "N1", "latitude": 0.0, "longitude": 0.0, "daily_orders": 10},
    ]
    whs = [Warehouse(warehouse_id="W1", latitude=0.0, longitude=0.0)]
    asgn = [Assignment(neighborhood_id="N1", warehouse_id="W1", distance_km=4.0,
                       weighted_distance=40.0, cost=60.0, within_radius=True, is_feasible=True)]
    m = compute_metrics(nodes, asgn, whs, cfg)
    assert m.total_fuel_cost == pytest.approx(10 * 4.0 * 0.5)
    assert m.fuel_live is False


def test_optimize_with_live_fuel(monkeypatch):
    from src.optimization import run_optimization
    monkeypatch.setenv("RAPIDAPI_KEY", "k")
    monkeypatch.setattr(fuel, "_fetch_state", lambda state: [
        {"city": "Bengaluru", "petrol": "110.93", "diesel": "98.8", "cng": "97", "autogas": None},
    ])
    nodes = [
        {"neighborhood_id": "N1", "latitude": 17.38, "longitude": 78.48, "daily_orders": 10},
        {"neighborhood_id": "N2", "latitude": 17.40, "longitude": 78.50, "daily_orders": 20},
    ]
    cfg = _fleet_cfg(K=1, use_live_fuel=True, fuel_city="Bengaluru")
    res = run_optimization(nodes, cfg)
    assert res.metrics.fuel_live is True
    assert res.metrics.total_fuel_cost > 0
    assert res.fuel_note and "Bengaluru" in res.fuel_note
    assert res.comparison is not None


def test_auto_city_from_data_center(monkeypatch):
    """No fuel_city configured → nearest priced city to the dataset wins."""
    monkeypatch.setenv("RAPIDAPI_KEY", "k")
    monkeypatch.setattr(fuel, "_fetch_state", lambda state: [
        {"city": "Mysore", "petrol": "110.44", "diesel": "98.39", "cng": "91.5", "autogas": None},
        {"city": "Bengaluru", "petrol": "110.93", "diesel": "98.8", "cng": "97", "autogas": None},
    ])
    # near Mysore → Mysore auto-picked, never asked
    price, live, city = fuel.price_for("petrol", city=None, state="Karnataka",
                                       near=(12.31, 76.66))
    assert live is True and city == "Mysore" and price == 110.44
    # full run without fuel_city → note names the auto city, per-node fuel set
    from src.optimization import run_optimization
    nodes = [
        {"neighborhood_id": "N1", "latitude": 12.30, "longitude": 76.65, "daily_orders": 10},
        {"neighborhood_id": "N2", "latitude": 12.32, "longitude": 76.67, "daily_orders": 20},
    ]
    cfg = _fleet_cfg(K=1, use_live_fuel=True, fuel_city=None)
    res = run_optimization(nodes, cfg)
    assert res.fuel_note and "Mysore" in res.fuel_note
    assert all(a.fuel_cost > 0 for a in res.assignments)
    assert res.metrics.total_fuel_cost == pytest.approx(
        sum(a.fuel_cost for a in res.assignments), abs=0.05)


def test_fuel_api_without_key():
    from src.api import app
    client = TestClient(app)
    r = client.get("/api/fuel/rates", params={"state": "Karnataka"})
    assert r.status_code == 200
    body = r.json()
    assert body["live"] is False
    assert "key_configured" in body
    assert "RAPIDAPI" not in r.text and "d9747" not in r.text
    r2 = client.get("/api/fuel/price", params={"fuel_type": "diesel"})
    assert r2.status_code == 200
    assert r2.json()["price_per_litre"] == fuel.FALLBACK_PRICES["diesel"]
    r3 = client.get("/api/fuel/price", params={"fuel_type": "rocket"})
    assert r3.status_code == 400
