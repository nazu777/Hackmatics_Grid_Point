"""Phase D+E (agent P1-B): per-order cost truth + expansion policy NPV tests."""
from fastapi.testclient import TestClient

from src.api import app
from src.cost import (
    assignment_table_rows,
    avg_cost_per_order,
    per_order_breakdown,
)
from src.expansion import expand_network, normalize_policy
from src.optimization import run_optimization
from src.schema import OptimizationConfig

client = TestClient(app)

NODES = [
    {"neighborhood_id": f"N{i + 1}", "latitude": 17.30 + 0.02 * i,
     "longitude": 78.40 + 0.015 * i, "daily_orders": 100 + 25 * i}
    for i in range(8)
]
EXISTING = [
    {"warehouse_id": "W1", "latitude": 17.36, "longitude": 78.47, "infra_cost": 1500.0},
    {"warehouse_id": "W2", "latitude": 17.46, "longitude": 78.55, "infra_cost": 1500.0},
]


def test_per_order_breakdown_reconciles_to_assignment():
    cfg = OptimizationConfig(cost_per_km=2.0, fuel_cost_per_km=0.5)
    row = per_order_breakdown(100, 5.0, cfg)
    assert row["distance_km"] == 5.0
    assert row["fuel_cost"] == round(100 * 5.0 * 0.5, 2)
    assert row["cost"] == round(100 * 5.0 * 2.5, 2)
    assert row["avg_cost_per_order"] == round(row["cost"] / 100, 2)


def test_assignment_rows_carry_road_km_fuel_cost():
    res = run_optimization(NODES, OptimizationConfig(K=2))
    rows = assignment_table_rows(
        NODES,
        res.comparison.optimized.assignments if res.comparison else res.assignments,
    )
    assert len(rows) == len(NODES)
    for r in rows:
        assert {"distance_km", "fuel_cost", "cost", "avg_cost_per_order"} <= set(r)
        assert r["avg_cost_per_order"] == round(r["cost"] / max(1, r["daily_orders"]), 2)
    total = sum(r["cost"] for r in rows)
    assert abs(total - sum(a.cost for a in res.assignments)) < 1.0


def test_avg_cost_per_order_matches_total():
    res = run_optimization(NODES, OptimizationConfig(K=2))
    demand = sum(n["daily_orders"] for n in NODES)
    assert avg_cost_per_order(res.metrics, demand) == round(res.metrics.total_cost / demand, 2)


def test_policy_defaults_gate_abandon_and_sell():
    out = expand_network(NODES, EXISTING, 1, OptimizationConfig())
    rec = out["recommendation"]
    assert len(rec["ranked_options"]) == 1  # toggles off: only keep-all
    assert rec["ranked_options"][0]["plan"].startswith("keep-all")
    assert "rationale" in rec and rec["rationale"]
    assert out["policy"]["allow_abandon_infra"] is False


def test_toggles_flip_recommendation():
    cfg = OptimizationConfig()
    base = expand_network(NODES, EXISTING, 1, cfg)["recommendation"]["ranked_options"][0]
    sell = expand_network(
        NODES, EXISTING, 1, cfg,
        policy={"allow_sell_vehicles": True, "resale_value": 5000.0,
                "horizon_months": 12, "revenue_per_order": 1.0},
    )["recommendation"]
    assert len(sell["ranked_options"]) == 2  # sell candidate appears only when allowed
    assert sell["ranked_options"][0]["plan"] != base["plan"]  # toggle flips the winner
    assert sell["ranked_options"][0]["proceeds"] == 5000.0

    ab = expand_network(
        NODES, EXISTING, 1, cfg,
        policy={"allow_abandon_infra": True, "demolition_cost": 50.0,
                "salvage_value": 400.0, "horizon_months": 12},
    )["recommendation"]
    assert any(o["abandoned_infra"] for o in ab["ranked_options"])
    # every ranked figure reconciles to Phase-D inputs (delivery/fuel deltas * horizon)
    for o in ab["ranked_options"]:
        assert o["npv"] == round(
            o["delivery_saved"] + o["revenue"] - o["infra"] - o["friction"] + o["proceeds"], 2)


def test_normalize_policy_clamps():
    p = normalize_policy({"horizon_months": 500, "revenue_per_order": -3, "bogus": 1})
    assert p["horizon_months"] == 120
    assert p["revenue_per_order"] == 0.0
    assert "bogus" not in p


def test_expand_endpoint_accepts_policy():
    resp = client.post("/api/expand", json={
        "neighborhoods": NODES,
        "warehouses": [{"warehouse_id": w["warehouse_id"], "latitude": w["latitude"],
                         "longitude": w["longitude"]} for w in EXISTING],
        "add_count": 1,
        "config": OptimizationConfig().model_dump(),
        "policy": {"allow_sell_vehicles": True, "resale_value": 100.0, "horizon_months": 6},
        "owned_vehicles": [{"vehicle_type": "van", "capacity": 120, "cost_per_km": 12.0}],
    })
    assert resp.status_code == 200
    body = resp.json()
    assert "recommendation" in body
    assert len(body["recommendation"]["ranked_options"]) == 2


def test_export_assignments_has_fuel_columns():
    res = run_optimization(NODES, OptimizationConfig(K=2))
    resp = client.post("/api/export/assignments", json={"result": res.model_dump()})
    assert resp.status_code == 200
    header = resp.text.splitlines()[0]
    for col in ("distance_km", "fuel_cost", "cost", "congestion_pct", "travel_time_min"):
        assert col in header
    assert len(resp.text.splitlines()) == len(NODES) + 1


def test_export_metrics_has_avg_cost_per_order():
    res = run_optimization(NODES, OptimizationConfig(K=2))
    resp = client.post("/api/export/metrics", json={"result": res.model_dump()})
    assert resp.status_code == 200
    assert "avg_cost_per_order" in resp.text
