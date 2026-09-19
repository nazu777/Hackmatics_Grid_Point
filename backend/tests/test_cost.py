"""
Phase 4 acceptance: cost formula verified on 3 hand-calculated examples (phases.md Phase 4).
"""
from src.cost import (
    assignment_cost,
    compute_comparison,
    compute_metrics,
    distance_histogram,
    effective_distance,
    effective_rate,
    metrics_table_rows,
)
from src.schema import (
    Assignment,
    LayoutEvaluation,
    Metrics,
    OptimizationConfig,
    Warehouse,
)


def _cfg(**kw):
    base = dict(cost_per_km=2.0, fuel_cost_per_km=0.0, traffic_factor=0.0,
                infra_cost_per_warehouse=0.0)
    base.update(kw)
    return OptimizationConfig(**base)


def test_handcalc_single_assignment():
    # Example 1: w=10, d=5km, rate=2.0 → cost = 10*5*2 = 100
    cfg = _cfg()
    assert assignment_cost(10, 5.0, cfg) == 100.0


def test_handcalc_traffic_and_fuel():
    # Example 2: w=4, d=10km, traffic 0.5 → d_eff=15; rate=1.0+0.5=1.5 → 4*15*1.5=90
    cfg = _cfg(cost_per_km=1.0, fuel_cost_per_km=0.5, traffic_factor=0.5)
    assert effective_distance(10.0, cfg) == 15.0
    assert effective_rate(cfg) == 1.5
    assert assignment_cost(4, 10.0, cfg) == 90.0


def test_handcalc_metrics_and_infra():
    # Example 3: 2 nodes w=10 each, d=3 and d=7 → Σd=10, Σwd=100, cost=100*1+2*50 infra=200
    cfg = _cfg(cost_per_km=1.0, infra_cost_per_warehouse=50.0)
    nodes = [
        {"neighborhood_id": "N1", "latitude": 0.0, "longitude": 0.0, "daily_orders": 10},
        {"neighborhood_id": "N2", "latitude": 1.0, "longitude": 1.0, "daily_orders": 10},
    ]
    whs = [Warehouse(warehouse_id="W1", latitude=0.0, longitude=0.0),
           Warehouse(warehouse_id="W2", latitude=1.0, longitude=1.0)]
    asgn = [
        Assignment(neighborhood_id="N1", warehouse_id="W1", distance_km=3.0,
                   weighted_distance=30.0, cost=30.0, within_radius=True, is_feasible=True),
        Assignment(neighborhood_id="N2", warehouse_id="W2", distance_km=7.0,
                   weighted_distance=70.0, cost=70.0, within_radius=True, is_feasible=True),
    ]
    m = compute_metrics(nodes, asgn, whs, cfg)
    assert m.total_unweighted_distance_km == 10.0
    assert m.total_weighted_distance_km_orders == 100.0
    assert m.total_cost == 200.0
    assert m.avg_distance_per_order_km == 5.0


def test_comparison_delta_and_table():
    b = Metrics(total_unweighted_distance_km=100.0, total_weighted_distance_km_orders=1000.0,
                total_cost=1000.0, avg_distance_per_order_km=10.0, avg_weighted_distance_km=500.0)
    o = Metrics(total_unweighted_distance_km=60.0, total_weighted_distance_km_orders=600.0,
                total_cost=600.0, avg_distance_per_order_km=6.0, avg_weighted_distance_km=300.0)
    comp = compute_comparison(LayoutEvaluation(metrics=b, warehouses=[]),
                              LayoutEvaluation(metrics=o, warehouses=[]))
    assert comp.delta.weighted_distance_saved == 400.0
    assert comp.delta.pct_cost_saved == 40.0
    rows = metrics_table_rows(b, o)
    assert rows[0]["metric"] == "total_unweighted_distance_km"
    assert rows[0]["saved"] == 40.0
    assert len(distance_histogram([
        Assignment(neighborhood_id=f"N{i}", warehouse_id="W1", distance_km=float(i),
                   weighted_distance=float(i), cost=float(i))
        for i in range(1, 6)
    ], bins=5)) == 5
