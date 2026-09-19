"""
GridPoint Cost Engine (Phase 4)
Implements schema.md §2.6 + PRD §5.6 formulas as a dedicated module.

Formulas:
  Total Unweighted Distance = Σ d_i
  Total Weighted Distance   = Σ w_i * d_i          (km·orders)
  Total Delivery Cost       = Σ w_i * d_eff_i * rate_eff + Σ infra_cost_k
    where d_eff_i = d_i * (1 + traffic_factor)
          rate_eff = fleet-weighted avg cost_per_km if vehicle_fleet else
                     cost_per_km + fuel_cost_per_km
  Avg Distance per Order    = Total Weighted Distance / Σ w_i
  Avg Weighted Distance     = Total Weighted Distance / N
"""
from typing import List, Dict, Any, Tuple
import math

from .schema import (
    Assignment,
    ComparisonDelta,
    ComparisonResult,
    LayoutEvaluation,
    Metrics,
    OptimizationConfig,
    Warehouse,
    WarehouseMetric,
)


def effective_rate(config: OptimizationConfig) -> float:
    """Unified $/km·order rate: fleet-weighted avg if fleet given, else cost+fuel."""
    if config.vehicle_fleet:
        total_cap = sum(max(1, v.capacity) for v in config.vehicle_fleet)
        weighted = sum(v.cost_per_km * max(1, v.capacity) for v in config.vehicle_fleet)
        base = weighted / max(1, total_cap)
        return base + float(config.fuel_cost_per_km or 0.0)
    return float(config.cost_per_km or 0.0) + float(config.fuel_cost_per_km or 0.0)


def effective_distance(d_km: float, config: OptimizationConfig) -> float:
    """Traffic-aware distance: d * (1 + traffic_factor)."""
    return float(d_km) * (1.0 + float(config.traffic_factor or 0.0))


def assignment_cost(w_i: int, d_km: float, config: OptimizationConfig) -> float:
    """Delivery cost for one neighborhood: w_i * d_eff * rate_eff."""
    return float(w_i) * effective_distance(d_km, config) * effective_rate(config)


def compute_metrics(
    neighborhoods: List[Dict[str, Any]],
    assignments: List[Assignment],
    warehouses: List[Warehouse],
    config: OptimizationConfig,
) -> Metrics:
    """Aggregate Metrics from per-assignment distances (distances are raw km)."""
    total_unweighted = 0.0
    total_weighted = 0.0
    total_cost = 0.0
    infeasible = sum(1 for a in assignments if not a.is_feasible)

    orders_by_wh: Dict[str, int] = {w.warehouse_id: 0 for w in warehouses}
    dists_by_wh: Dict[str, List[float]] = {w.warehouse_id: [] for w in warehouses}
    nodes_by_wh: Dict[str, int] = {w.warehouse_id: 0 for w in warehouses}
    demand_by_id: Dict[str, int] = {
        str(n["neighborhood_id"]): int(n["daily_orders"]) for n in neighborhoods
    }

    for a in assignments:
        w_i = demand_by_id.get(str(a.neighborhood_id), 0)
        total_unweighted += float(a.distance_km)
        total_weighted += float(a.weighted_distance)
        total_cost += float(a.cost)
        if a.warehouse_id in orders_by_wh:
            orders_by_wh[a.warehouse_id] += w_i
            dists_by_wh[a.warehouse_id].append(float(a.distance_km))
            nodes_by_wh[a.warehouse_id] += 1

    total_cost += float(config.infra_cost_per_warehouse or 0.0) * len(warehouses)

    for w in warehouses:
        w.assigned_orders = orders_by_wh.get(w.warehouse_id, 0)
        if config.capacity_enabled and config.C_max:
            w.utilization_pct = round(orders_by_wh.get(w.warehouse_id, 0) / config.C_max * 100.0, 1)
        else:
            w.utilization_pct = None

    wh_metrics = [
        WarehouseMetric(
            warehouse_id=w.warehouse_id,
            assigned_orders=orders_by_wh.get(w.warehouse_id, 0),
            utilization_pct=w.utilization_pct,
            avg_distance_km=round(
                sum(dists_by_wh.get(w.warehouse_id, [])) / max(1, len(dists_by_wh.get(w.warehouse_id, []))), 2
            ),
            neighborhood_count=nodes_by_wh.get(w.warehouse_id, 0),
        )
        for w in warehouses
    ]

    total_demand = sum(int(n["daily_orders"]) for n in neighborhoods)
    n = max(1, len(neighborhoods))
    return Metrics(
        total_unweighted_distance_km=round(total_unweighted, 2),
        total_weighted_distance_km_orders=round(total_weighted, 2),
        total_cost=round(total_cost, 2),
        avg_distance_per_order_km=round(total_weighted / max(1, total_demand), 2),
        avg_weighted_distance_km=round(total_weighted / n, 2),
        warehouses=wh_metrics,
        infeasible_assignments=infeasible,
        feasibility_ratio=round((len(assignments) - infeasible) / max(1, len(assignments)), 4),
    )


def compute_comparison(
    baseline_eval: LayoutEvaluation, optimized_eval: LayoutEvaluation
) -> ComparisonResult:
    """Build ComparisonResult delta (schema.md §2.7)."""
    base_dist = baseline_eval.metrics.total_weighted_distance_km_orders
    opt_dist = optimized_eval.metrics.total_weighted_distance_km_orders
    dist_saved = max(0.0, base_dist - opt_dist)
    base_cost = baseline_eval.metrics.total_cost
    opt_cost = optimized_eval.metrics.total_cost
    cost_saved = max(0.0, base_cost - opt_cost)
    delta = ComparisonDelta(
        distance_saved_km=round(
            max(0.0, baseline_eval.metrics.total_unweighted_distance_km
                - optimized_eval.metrics.total_unweighted_distance_km), 2
        ),
        weighted_distance_saved=round(dist_saved, 2),
        cost_saved=round(cost_saved, 2),
        pct_distance_saved=round(dist_saved / max(0.001, base_dist) * 100.0, 2),
        pct_cost_saved=round(cost_saved / max(0.001, base_cost) * 100.0, 2),
    )
    return ComparisonResult(baseline=baseline_eval, optimized=optimized_eval, delta=delta)


def distance_histogram(assignments: List[Assignment], bins: int = 10) -> List[Dict[str, Any]]:
    """Bucket raw distance_km values for distribution charts (Phase 4 task 3)."""
    if not assignments:
        return []
    vals = [float(a.distance_km) for a in assignments]
    lo, hi = min(vals), max(vals)
    if hi <= lo:
        return [{"bin_start": round(lo, 2), "bin_end": round(hi, 2), "count": len(vals)}]
    width = (hi - lo) / max(1, bins)
    out: List[Dict[str, Any]] = []
    for b in range(max(1, bins)):
        start = lo + b * width
        end = start + width if b < bins - 1 else hi + 1e-9
        count = sum(1 for v in vals if (start <= v < end) or (b == bins - 1 and v <= hi))
        out.append({"bin_start": round(start, 2), "bin_end": round(end, 2), "count": count})
    return out


def metrics_table_rows(
    baseline: Metrics, optimized: Metrics
) -> List[Dict[str, Any]]:
    """Side-by-side exportable rows: metric | baseline | optimized | delta | %."""
    pairs: List[Tuple[str, float, float]] = [
        ("total_unweighted_distance_km", baseline.total_unweighted_distance_km, optimized.total_unweighted_distance_km),
        ("total_weighted_distance_km_orders", baseline.total_weighted_distance_km_orders, optimized.total_weighted_distance_km_orders),
        ("total_cost", baseline.total_cost, optimized.total_cost),
        ("avg_distance_per_order_km", baseline.avg_distance_per_order_km, optimized.avg_distance_per_order_km),
        ("avg_weighted_distance_km", baseline.avg_weighted_distance_km, optimized.avg_weighted_distance_km),
        ("feasibility_ratio", baseline.feasibility_ratio, optimized.feasibility_ratio),
    ]
    rows: List[Dict[str, Any]] = []
    for name, b, o in pairs:
        delta = round(b - o, 4)
        pct = round((delta / b * 100.0) if b else 0.0, 2)
        rows.append({"metric": name, "baseline": b, "optimized": o, "saved": delta, "pct_saved": pct})
    return rows
