"""
Unit tests for Phase 5 Scenarios & Bonus Features
"""
import pytest
from src.schema import Neighborhood, OptimizationConfig, VehicleType
from src.scenarios import (
    compute_tradeoff_curve,
    simulate_demand_shift,
    calculate_fleet_eta,
    diagnose_constraints,
)
from src.optimization import run_optimization


@pytest.fixture
def sample_neighborhoods():
    return [
        {"neighborhood_id": "N1", "latitude": 17.38, "longitude": 78.48, "daily_orders": 100},
        {"neighborhood_id": "N2", "latitude": 17.44, "longitude": 78.38, "daily_orders": 250},
        {"neighborhood_id": "N3", "latitude": 17.49, "longitude": 78.40, "daily_orders": 150},
        {"neighborhood_id": "N4", "latitude": 17.36, "longitude": 78.47, "daily_orders": 80},
    ]


def test_simulate_demand_shift_increase(sample_neighborhoods):
    shifted, stats = simulate_demand_shift(sample_neighborhoods, 20.0)
    assert len(shifted) == len(sample_neighborhoods)
    assert stats["pct_delta"] == 20.0
    assert stats["new_total_orders"] > stats["original_total_orders"]
    # Check that N2 (250 orders) scaled to 250 * 1.20 = 300
    n2 = next(n for n in shifted if n["neighborhood_id"] == "N2")
    assert n2["daily_orders"] == 300


def test_simulate_demand_shift_decrease(sample_neighborhoods):
    shifted, stats = simulate_demand_shift(sample_neighborhoods, -50.0)
    assert stats["new_total_orders"] < stats["original_total_orders"]
    for n in shifted:
        assert n["daily_orders"] >= 1


def test_compute_tradeoff_curve(sample_neighborhoods):
    cfg = OptimizationConfig(
        K=2,
        cost_per_km=1.5,
        infra_cost_per_warehouse=500.0,
    )
    res = compute_tradeoff_curve(sample_neighborhoods, cfg, max_k=3)
    points = res["points"]
    assert len(points) == 3
    assert res["optimal_K"] in [1, 2, 3]
    # Check that infra cost increases monotonically with K
    for i in range(len(points) - 1):
        assert points[i + 1]["infra_cost"] > points[i]["infra_cost"]


def test_calculate_fleet_eta(sample_neighborhoods):
    cfg = OptimizationConfig(
        K=2,
        traffic_factor=0.3, # 30% traffic delay
        vehicle_fleet=[
            VehicleType(vehicle_type="E-Bike", capacity=30, cost_per_km=0.5, avg_speed_kmph=25.0),
            VehicleType(vehicle_type="Van", capacity=150, cost_per_km=1.2, avg_speed_kmph=40.0),
        ]
    )
    opt_res = run_optimization(sample_neighborhoods, cfg)
    eta_res = calculate_fleet_eta(opt_res.assignments, cfg, vehicle_type="Van")
    assert eta_res["avg_eta_minutes"] > 0
    assert eta_res["vehicle_used"] == "Van"
    assert eta_res["traffic_congestion_pct"] == 30.0


def test_diagnose_constraints_violations(sample_neighborhoods):
    cfg = OptimizationConfig(
        K=1,
        capacity_enabled=True,
        C_max=200, # total demand is 580 -> will overflow
        radius_enabled=True,
        R_max_km=2.0, # distance between nodes is >2km -> will violate
    )
    opt_res = run_optimization(sample_neighborhoods, cfg)
    diag = diagnose_constraints(opt_res.warehouses, opt_res.assignments, cfg)
    assert not diag["is_compliant"]
    assert len(diag["capacity_violations"]) > 0 or len(diag["radius_violations"]) > 0
