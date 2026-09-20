"""Tests for road routing provider + road-metric optimization (no network)."""
import numpy as np
import pytest

from src import routing
from src.schema import OptimizationConfig


@pytest.fixture(autouse=True)
def _clean(monkeypatch, tmp_path):
    monkeypatch.delenv("TOMTOM_KEY", raising=False)
    monkeypatch.setenv("TRAFFIC_HISTORY_PATH", str(tmp_path / "hist.json"))
    routing.clear_matrix_cache()
    routing.clear_route_cache()
    yield
    routing.clear_matrix_cache()
    routing.clear_route_cache()


def _pts():
    origins = [(17.38, 78.48), (17.40, 78.50)]
    dests = [(17.39, 78.49)]
    return origins, dests


def test_osrm_parsing(monkeypatch):
    import urllib.request, io

    class FakeResp:
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def read(self):
            import json
            return json.dumps({
                "code": "Ok",
                "distances": [[2500.0], [3200.0]],
                "durations": [[300.0], [360.0]],
            }).encode()

    monkeypatch.setattr(urllib.request, "urlopen", lambda req, timeout=20: FakeResp())
    dist, dur, note = routing.fetch_matrix(*_pts())
    assert dist.shape == (2, 1)
    assert dist[0, 0] == pytest.approx(2.5)
    assert dur is not None and dur[0, 0] == pytest.approx(5.0)
    assert "OSRM" in note


def test_tomtom_preferred_when_live(monkeypatch):
    import urllib.request

    def fake_open(req, timeout=20):
        url = req.full_url if hasattr(req, "full_url") else str(req)
        raise AssertionError(f"no HTTP expected, got {url}")

    monkeypatch.setattr(urllib.request, "urlopen", fake_open)
    monkeypatch.setenv("TOMTOM_KEY", "k")
    monkeypatch.setattr(routing, "_tomtom_matrix",
                        lambda o, d, live_traffic=False: (np.array([[7.5], [8.0]]),
                                                          np.array([[12.0], [14.0]])))
    dist, dur, note = routing.fetch_matrix(*_pts(), live_traffic=True)
    assert dist[1, 0] == pytest.approx(8.0)
    assert dur is not None and dur[0, 0] == pytest.approx(12.0)
    assert "TomTom" in note


def test_haversine_fallback_when_offline(monkeypatch):
    import urllib.request

    def boom(req, timeout=20):
        raise OSError("offline")

    monkeypatch.setattr(urllib.request, "urlopen", boom)
    dist, dur, note = routing.fetch_matrix(*_pts())
    assert dist.shape == (2, 1) and dist[0, 0] > 0
    assert dur is None
    assert "fallback" in note.lower() or "Straight-line" in note


def test_chunking_and_cache(monkeypatch):
    calls = []

    def fake_osrm(origins, dests):
        calls.append((len(origins), len(dests)))
        n, m = len(origins), len(dests)
        return np.full((n, m), 5.0), np.full((n, m), 8.0)

    monkeypatch.setattr(routing, "_osrm_table", fake_osrm)
    origins = [(17.0 + i * 0.01, 78.0) for i in range(120)]
    dests = [(17.5, 78.5), (17.6, 78.6)]
    dist, dur, _ = routing.fetch_matrix(origins, dests)
    assert dist.shape == (120, 2)
    assert all(c[0] <= 93 and c[1] == 2 for c in calls)  # chunked under the limit
    n_calls = len(calls)
    dist2, _, note2 = routing.fetch_matrix(origins, dests)
    assert len(calls) == n_calls  # cache hit: no new provider calls
    assert "cached" in note2
    assert np.array_equal(dist, dist2)


def test_optimize_road_metric_uses_provider(monkeypatch):
    from src.optimization import run_optimization

    seen = {}

    def fake_road(c1, c2, live_traffic=False):
        seen["calls"] = seen.get("calls", 0) + 1
        n, m = len(c1), len(c2)
        return np.full((n, m), 3.0), np.full((n, m), 6.0), "mock roads"

    import src.routing as rmod
    monkeypatch.setattr(rmod, "road_matrices", fake_road)
    # patch the reference imported into optimization namespace lazily
    nodes = [
        {"neighborhood_id": "N1", "latitude": 17.38, "longitude": 78.48, "daily_orders": 10},
        {"neighborhood_id": "N2", "latitude": 17.40, "longitude": 78.50, "daily_orders": 20},
    ]
    cfg = OptimizationConfig(K=1, distance_metric="road")
    res = run_optimization(nodes, cfg)
    assert seen.get("calls", 0) >= 1
    assert all(a.distance_km == pytest.approx(3.0) for a in res.assignments)
    assert all(a.travel_time_min == pytest.approx(6.0) for a in res.assignments)
    assert res.routing_note and "mock roads" in res.routing_note
    assert res.comparison is not None


def test_road_metric_reassigns_to_road_nearest(monkeypatch):
    """Unconstrained road optimization must assign by road distance.

    K-Means labels are euclidean in degree space; under metric="road" every
    node must end up at its road-nearest center with matching distances.
    """
    from src.optimization import run_optimization
    from src.schema import Warehouse

    # Road matrix (3 nodes x 2 centers): node0->W1, node1->W2, node2->W2.
    # Deliberately independent of straight-line geometry.
    road_2 = np.array([[1.0, 9.0], [9.0, 1.0], [8.0, 2.0]])

    def fake_road(c1, c2, live_traffic=False):
        n, m = len(np.atleast_2d(c1)), len(np.atleast_2d(c2))
        if m == 2:
            assert n == 3
            return road_2.copy(), np.full((n, m), 5.0), "mock roads"
        return np.full((n, m), 4.0), np.full((n, m), 5.0), "mock roads"

    import src.routing as rmod
    monkeypatch.setattr(rmod, "road_matrices", fake_road)
    nodes = [
        {"neighborhood_id": "N1", "latitude": 17.38, "longitude": 78.48, "daily_orders": 10},
        {"neighborhood_id": "N2", "latitude": 17.40, "longitude": 78.50, "daily_orders": 20},
        {"neighborhood_id": "N3", "latitude": 17.42, "longitude": 78.52, "daily_orders": 30},
    ]
    cfg = OptimizationConfig(K=2, distance_metric="road")
    res = run_optimization(nodes, cfg)
    got = {a.neighborhood_id: a.warehouse_id for a in res.assignments}
    assert got == {"N1": "W1", "N2": "W2", "N3": "W2"}
    dist = {a.neighborhood_id: a.distance_km for a in res.assignments}
    assert dist == pytest.approx({"N1": 1.0, "N2": 1.0, "N3": 2.0})
    # Baseline (single center) also evaluates on road distances.
    assert res.comparison is not None
    assert all(a.distance_km == pytest.approx(4.0)
               for a in res.comparison.baseline.assignments)


def test_baseline_custom_uses_road_labels(monkeypatch):
    """Baseline with custom warehouses assigns by road, not straight-line."""
    from src.optimization import compute_baseline_layout

    road_2 = np.array([[1.0, 9.0], [9.0, 1.0]])

    def fake_road(c1, c2, live_traffic=False):
        n, m = len(np.atleast_2d(c1)), len(np.atleast_2d(c2))
        if m == 2:
            return road_2.copy(), None, "mock roads"
        return np.full((n, m), 4.0), None, "mock roads"

    import src.routing as rmod
    monkeypatch.setattr(rmod, "road_matrices", fake_road)
    nodes = [
        {"neighborhood_id": "N1", "latitude": 17.38, "longitude": 78.48, "daily_orders": 10},
        {"neighborhood_id": "N2", "latitude": 17.40, "longitude": 78.50, "daily_orders": 20},
    ]
    cfg = OptimizationConfig(
        K=2,
        distance_metric="road",
        baseline_mode="custom",
        custom_baseline_warehouses=[
            {"warehouse_id": "B1", "latitude": 0.0, "longitude": 0.0},
            {"warehouse_id": "B2", "latitude": 50.0, "longitude": 50.0},
        ],
    )
    ev = compute_baseline_layout(nodes, cfg)
    got = {a.neighborhood_id: a.warehouse_id for a in ev.assignments}
    # Road matrix says N1->first center, N2->second (straight-line would agree
    # here by construction, so assert exact road distances as the real check).
    assert got == {"N1": "W1", "N2": "W2"}
    assert [a.distance_km for a in ev.assignments] == pytest.approx([1.0, 1.0])


def test_route_geometry_tomtom(monkeypatch):
    import urllib.request

    class FakeResp:
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def read(self):
            import json
            return json.dumps({
                "routes": [{
                    "summary": {"lengthInMeters": 7363, "travelTimeInSeconds": 1075},
                    "legs": [{"points": [
                        {"latitude": 12.93, "longitude": 77.62},
                        {"latitude": 12.95, "longitude": 77.60},
                        {"latitude": 12.97, "longitude": 77.59},
                    ]}],
                }],
            }).encode()

    monkeypatch.setenv("TOMTOM_KEY", "k")
    monkeypatch.setattr(urllib.request, "urlopen", lambda req, timeout=15: FakeResp())
    got = routing.route_geometry((12.93, 77.62), (12.97, 77.59), live_traffic=True)
    assert got["provider"] == "tomtom-live"
    assert got["distance_km"] == pytest.approx(7.36)
    assert got["duration_min"] == pytest.approx(17.9, abs=0.1)
    assert len(got["line"]) == 3 and got["line"][0][0] == pytest.approx(77.62)


def test_route_geometry_osrm_fallback(monkeypatch):
    import urllib.request

    class FakeResp:
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def read(self):
            import json
            return json.dumps({
                "code": "Ok",
                "routes": [{"distance": 5200.0, "duration": 480.0,
                            "geometry": {"coordinates": [[77.62, 12.93], [77.59, 12.97]]}}],
            }).encode()

    monkeypatch.delenv("TOMTOM_KEY", raising=False)
    monkeypatch.setattr(urllib.request, "urlopen", lambda req, timeout=15: FakeResp())
    got = routing.route_geometry((12.93, 77.62), (12.97, 77.59))
    assert got["provider"] == "osrm"
    assert got["distance_km"] == pytest.approx(5.2)


def test_route_geometry_straight_fallback(monkeypatch):
    import urllib.request

    def boom(req, timeout=15):
        raise OSError("offline")

    monkeypatch.delenv("TOMTOM_KEY", raising=False)
    monkeypatch.setattr(urllib.request, "urlopen", boom)
    got = routing.route_geometry((12.93, 77.62), (12.97, 77.59))
    assert got["provider"] == "haversine"
    assert len(got["line"]) == 2 and got["duration_min"] is None


def test_routes_api(monkeypatch):
    import urllib.request
    monkeypatch.delenv("TOMTOM_KEY", raising=False)

    def boom(req, timeout=15):
        raise OSError("offline")

    monkeypatch.setattr(urllib.request, "urlopen", boom)
    from src.api import app
    from fastapi.testclient import TestClient
    client = TestClient(app)
    body = {"pairs": [{"frm": {"lat": 12.93, "lon": 77.62}, "to": {"lat": 12.97, "lon": 77.59}}]}
    r = client.post("/api/routes/geometry", json=body)
    assert r.status_code == 200
    routes = r.json()["routes"]
    assert len(routes) == 1 and routes[0]["provider"] == "haversine"
    assert "d3rZl2" not in r.text
    big = {"pairs": [{"frm": {"lat": 0.0, "lon": 0.0}, "to": {"lat": 1.0, "lon": 1.0}}] * 61}
    assert client.post("/api/routes/geometry", json=big).status_code == 400
    # malformed pairs are 400s with STRING details (never 422 arrays that
    # stringify to "[object Object], ..." on the client)
    bad = {"pairs": [["a", "b"], {"frm": {"lat": "NaNx", "lon": 0.0}, "to": {"lat": 1.0, "lon": 1.0}}]}
    r_bad = client.post("/api/routes/geometry", json=bad)
    assert r_bad.status_code == 400
    assert isinstance(r_bad.json()["detail"], str)
