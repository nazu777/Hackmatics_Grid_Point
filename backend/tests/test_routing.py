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
    yield
    routing.clear_matrix_cache()


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
