"""Tests for incremental warehouse expansion (/api/expand)."""
import pytest
from fastapi.testclient import TestClient
from src.api import app
from src.expansion import expand_network
from src.schema import OptimizationConfig

client = TestClient(app)

NODES = [
    {"neighborhood_id": f"N{i+1}", "latitude": 17.30 + 0.02 * i,
     "longitude": 78.40 + 0.015 * i, "daily_orders": 100 + 25 * i}
    for i in range(12)
]

EXISTING = [
    {"warehouse_id": "W1", "latitude": 17.36, "longitude": 78.47},
    {"warehouse_id": "W2", "latitude": 17.46, "longitude": 78.55},
]


def test_expand_keeps_existing_and_adds():
    out = expand_network(NODES, EXISTING, 1, OptimizationConfig())
    res = out["result"]
    assert out["added"] == 1
    assert out["new_warehouse_ids"] == ["W3"]
    assert [w.warehouse_id for w in res.warehouses[:2]] == ["W1", "W2"]
    assert abs(res.warehouses[0].latitude - 17.36) < 1e-9
    assert abs(res.warehouses[1].longitude - 78.55) < 1e-9
    assert len(res.warehouses) == 3
    assert len(res.assignments) == len(NODES)
    assert res.comparison is not None  # before-vs-after delta present


def test_expand_relieves_heaviest_load():
    out = expand_network(NODES, EXISTING, 2, OptimizationConfig())
    loads_before = {r["warehouse_id"]: r["before_orders"] for r in out["relief"]}
    loads_after = {r["warehouse_id"]: r["after_orders"] for r in out["relief"]}
    assert max(loads_after.values()) <= max(loads_before.values())
    total = sum(n["daily_orders"] for n in NODES)
    assert sum(loads_before.values()) == total  # existing cover all demand before
    assert sum(w.assigned_orders or 0 for w in out["result"].warehouses) == total


def test_expand_caps_at_ten_and_node_count():
    out = expand_network(NODES, EXISTING, 50, OptimizationConfig())
    assert len(out["result"].warehouses) == 10  # schema K cap wins over request


def test_expand_rejects_bad_input():
    with pytest.raises(ValueError):
        expand_network(NODES, EXISTING, 0, OptimizationConfig())
    with pytest.raises(ValueError):
        expand_network([], EXISTING, 1, OptimizationConfig())
    with pytest.raises(ValueError):
        expand_network(NODES, [], 1, OptimizationConfig())


def test_expand_endpoint():
    resp = client.post("/api/expand", json={
        "neighborhoods": NODES,
        "warehouses": EXISTING,
        "add_count": 1,
        "config": OptimizationConfig().model_dump(),
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["new_warehouse_ids"] == ["W3"]
    assert len(data["result"]["warehouses"]) == 3


def test_expand_endpoint_rejects_zero():
    resp = client.post("/api/expand", json={
        "neighborhoods": NODES,
        "warehouses": EXISTING,
        "add_count": 0,
    })
    assert resp.status_code == 400
