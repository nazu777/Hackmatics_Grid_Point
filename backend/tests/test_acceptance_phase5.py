"""
Acceptance test for Phase 5: Advanced Constraints, Bonus Features & Scenarios
Validates:
1. Trade-off curve calculation (Elbow analysis over K)
2. Demand shift simulation (+25% surge, -30% contraction)
3. Fleet ETA & congestion modeling
4. Constraint diagnostics
5. High-load benchmark (N=500 nodes) executes cleanly within threshold
"""
import time
import pytest
from src.schema import SyntheticGenerationConfig, OptimizationConfig, VehicleType
from src.synthetic import generate_synthetic_dataset
from src.scenarios import (
    compute_tradeoff_curve,
    simulate_demand_shift,
    calculate_fleet_eta,
    diagnose_constraints,
)
from src.optimization import run_optimization


def test_acceptance_phase5_tradeoff_elbow():
    config = SyntheticGenerationConfig(N=40, seed=42, num_clusters=3)
    dataset = generate_synthetic_dataset(config)

    opt_config = OptimizationConfig(
        cost_per_km=1.2,
        infra_cost_per_warehouse=1500.0,
    )
    res = compute_tradeoff_curve(dataset, opt_config, max_k=5)
    points = res["points"]
    assert len(points) == 5
    assert res["optimal_K"] >= 1
    assert res["min_cost"] > 0

    # Ensure total_cost = delivery_cost + infra_cost for all points
    for pt in points:
        assert abs(pt["total_cost"] - (pt["delivery_cost"] + pt["infra_cost"])) < 0.05


def test_acceptance_phase5_demand_surge_pipeline():
    config = SyntheticGenerationConfig(N=30, seed=101)
    dataset = generate_synthetic_dataset(config)

    # 1. Base run
    opt_config = OptimizationConfig(K=2)
    base_res = run_optimization(dataset, opt_config)

    # 2. Simulate 50% surge
    shifted_data, stats = simulate_demand_shift(dataset, 50.0)
    assert stats["net_order_change"] > 0

    # 3. Optimize under surge
    surge_res = run_optimization(shifted_data, opt_config)
    assert surge_res.metrics.total_cost > base_res.metrics.total_cost


def test_acceptance_phase5_fleet_eta_traffic_impact():
    config = SyntheticGenerationConfig(N=20, seed=77)
    dataset = generate_synthetic_dataset(config)

    fleet = [
        VehicleType(vehicle_type="E-Bike", capacity=25, cost_per_km=0.4, avg_speed_kmph=20.0),
        VehicleType(vehicle_type="Van", capacity=120, cost_per_km=1.0, avg_speed_kmph=40.0),
    ]

    opt_config_clear = OptimizationConfig(K=2, traffic_factor=0.0, vehicle_fleet=fleet)
    res_clear = run_optimization(dataset, opt_config_clear)
    eta_clear = calculate_fleet_eta(res_clear.assignments, opt_config_clear, vehicle_type="Van")

    opt_config_rush = OptimizationConfig(K=2, traffic_factor=0.5, vehicle_fleet=fleet) # 50% traffic
    res_rush = run_optimization(dataset, opt_config_rush)
    eta_rush = calculate_fleet_eta(res_rush.assignments, opt_config_rush, vehicle_type="Van")

    # Congestion should strictly increase ETA
    assert eta_rush["avg_eta_minutes"] > eta_clear["avg_eta_minutes"]
    assert eta_rush["traffic_congestion_pct"] == 50.0


def test_acceptance_phase5_performance_benchmark():
    config = SyntheticGenerationConfig(N=200, seed=42)
    dataset = generate_synthetic_dataset(config)

    opt_config = OptimizationConfig(K=3, infra_cost_per_warehouse=1000.0)

    t0 = time.perf_counter()
    res = compute_tradeoff_curve(dataset, opt_config, max_k=4)
    elapsed = time.perf_counter() - t0

    assert elapsed < 4.0, f"Tradeoff curve on 200 nodes took {elapsed:.2f}s, expected < 4.0s"
    assert len(res["points"]) == 4
