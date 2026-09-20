"""
GridPoint Cost Engine (Phase 4)
Implements schema.md §2.6 + PRD §5.6 formulas as a dedicated module.

Formulas:
  Total Unweighted Distance = Σ d_i
  Total Weighted Distance   = Σ w_i * d_i          (km·orders)
  Total Delivery Cost       = Σ w_i * d_eff_i * rate_eff + Σ infra_cost_k
    where d_eff_i = d_i * (1 + traffic_factor)
          rate_eff = base_rate + fuel_rate
          base_rate = fleet-weighted avg cost_per_km if vehicle_fleet else cost_per_km
          fuel_rate = fleet-weighted fuel burn (live ₹/L ÷ mileage) + fuel_cost_per_km
  Avg Distance per Order    = Total Weighted Distance / Σ w_i
  Avg Weighted Distance     = Total Weighted Distance / N
"""
from typing import List, Dict, Any, Optional, Tuple
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
from .fuel import FALLBACK_PRICES, price_for


def resolve_fuel_prices(config: OptimizationConfig,
                          center: Optional[Tuple[float, float]] = None) -> Tuple[Dict[str, float], bool, str]:
    """
    ₹/litre by fuel type for this run + live flag + human note.
    Live lookup happens only when config.use_live_fuel is set; otherwise the
    manual fuel_cost_per_km surcharge alone drives the fuel portion.
    When config.fuel_city is unset, the city is auto-derived as the nearest
    priced city to the dataset `center` (lat, lon) — never ask the user.
    """
    if not config.use_live_fuel:
        return {}, False, "Manual fuel surcharge (live prices off)"
    prices: Dict[str, float] = {}
    live_any = False
    cities: List[str] = []
    for fuel in ("petrol", "diesel", "cng", "autogas"):
        price, live, city = price_for(fuel, config.fuel_city, config.fuel_state, near=center)
        if price is not None:
            prices[fuel] = price
            live_any = live_any or live
            if city and city not in cities:
                cities.append(city)
    where = cities[0] if cities else config.fuel_state
    petrol = prices.get("petrol")
    note = (
        f"Live {where} petrol ₹{petrol:.2f}/L" if (live_any and petrol)
        else f"{where} fallback rates (live API unreachable)"
    )
    return prices, live_any, note


def _fleet_burn_rate(config: OptimizationConfig, prices: Dict[str, float]) -> float:
    """Fleet-weighted fuel burn ₹/km·order from live prices ÷ mileage (0 if unset)."""
    if not config.vehicle_fleet or not prices:
        return 0.0
    total_cap = 0
    weighted = 0.0
    for v in config.vehicle_fleet:
        if not v.mileage_kmpl or v.mileage_kmpl <= 0:
            continue
        price = prices.get((v.fuel_type or "petrol").strip().lower())
        if price is None:
            continue
        cap = max(1, v.capacity)
        total_cap += cap
        weighted += (price / v.mileage_kmpl) * cap
    return weighted / max(1, total_cap)


def split_rate(config: OptimizationConfig,
               prices: Optional[Dict[str, float]] = None) -> Tuple[float, float]:
    """(base_rate, fuel_rate) operating vs fuel portions of the unified rate."""
    if prices is None:
        prices, _, _ = resolve_fuel_prices(config)
    if config.vehicle_fleet:
        total_cap = sum(max(1, v.capacity) for v in config.vehicle_fleet)
        weighted = sum(v.cost_per_km * max(1, v.capacity) for v in config.vehicle_fleet)
        base = weighted / max(1, total_cap)
    else:
        base = float(config.cost_per_km or 0.0)
    fuel = _fleet_burn_rate(config, prices) + float(config.fuel_cost_per_km or 0.0)
    return base, fuel


def effective_rate(config: OptimizationConfig,
                   prices: Optional[Dict[str, float]] = None) -> float:
    """Unified $/km·order rate: base operating rate + fuel rate."""
    base, fuel = split_rate(config, prices)
    return base + fuel


def assignment_fuel_cost(w_i: int, d_km: float, config: OptimizationConfig,
                          prices: Optional[Dict[str, float]] = None,
                          congestion: Optional[float] = None) -> float:
    """Fuel-only portion of one neighborhood's delivery cost.

    Fuel burn = live pump price (₹/L) ÷ fleet mileage (km/L) per km·order,
    plus any manual fuel_cost_per_km surcharge. Road distance in, fuel ₹ out.
    """
    _, fuel_rate = split_rate(config, prices)
    return float(w_i) * effective_distance(d_km, config, congestion) * fuel_rate


def per_order_breakdown(w_i: int, d_km: float, config: OptimizationConfig,
                        prices: Optional[Dict[str, float]] = None,
                        congestion: Optional[float] = None) -> Dict[str, float]:
    """Per-order road+fuel truth for one neighborhood (Phase D #7).

    Returns road km, effective km (traffic-aware), fuel cost, total cost,
    and avg cost per order. Pure function — no I/O, uses the same
    split_rate/effective_distance math as compute_metrics so figures reconcile.
    """
    if prices is None:
        prices, _, _ = resolve_fuel_prices(config)
    d_eff = effective_distance(d_km, config, congestion)
    fuel = assignment_fuel_cost(w_i, d_km, config, prices, congestion)
    total = assignment_cost(w_i, d_km, config, prices, congestion)
    orders = max(1, int(w_i))
    return {
        "distance_km": round(float(d_km), 2),
        "effective_distance_km": round(float(d_eff), 2),
        "fuel_cost": round(float(fuel), 2),
        "cost": round(float(total), 2),
        "avg_cost_per_order": round(float(total) / orders, 2),
    }


def avg_cost_per_order(metrics: Metrics, total_orders: int) -> float:
    """Overall avg delivery cost per order (total_cost / Σw_i)."""
    if total_orders <= 0:
        return 0.0
    return round(float(metrics.total_cost) / total_orders, 2)


def assignment_table_rows(
    neighborhoods: List[Dict[str, Any]],
    assignments: List[Assignment],
) -> List[Dict[str, Any]]:
    """Per-node exportable rows: every row carries road km + fuel + cost.

    Joins demand (daily_orders) onto each assignment and derives
    avg_cost_per_order so the table reconciles to Metrics row-for-row:
    Σ weighted_distance == total_weighted_distance, Σ cost (+infra) == total_cost.
    """
    demand_by_id: Dict[str, int] = {
        str(n.get("neighborhood_id")): int(n.get("daily_orders", 0) or 0)
        for n in neighborhoods
    }
    rows: List[Dict[str, Any]] = []
    for a in assignments:
        w_i = demand_by_id.get(str(a.neighborhood_id), 0)
        avg = round(float(a.cost) / max(1, w_i), 2)
        rows.append({
            "neighborhood_id": str(a.neighborhood_id),
            "warehouse_id": str(a.warehouse_id),
            "daily_orders": w_i,
            "distance_km": round(float(a.distance_km), 2),
            "weighted_distance": round(float(a.weighted_distance), 2),
            "fuel_cost": round(float(a.fuel_cost or 0.0), 2),
            "cost": round(float(a.cost), 2),
            "avg_cost_per_order": avg,
            "congestion_pct": a.congestion_pct,
            "travel_time_min": a.travel_time_min,
            "within_radius": bool(a.within_radius),
            "is_feasible": bool(a.is_feasible),
        })
    return rows


def corridor_congestion(config: OptimizationConfig,
                          congestion: Optional[float] = None) -> float:
    """Congestion delay ratio: per-corridor observed value wins over the manual floor."""
    manual = float(config.traffic_factor or 0.0)
    if congestion is None:
        return manual
    return max(manual, float(congestion))


def effective_distance(d_km: float, config: OptimizationConfig,
                       congestion: Optional[float] = None) -> float:
    """Traffic-aware distance: d * (1 + corridor congestion)."""
    return float(d_km) * (1.0 + corridor_congestion(config, congestion))


def assignment_cost(w_i: int, d_km: float, config: OptimizationConfig,
                      prices: Optional[Dict[str, float]] = None,
                      congestion: Optional[float] = None) -> float:
    """Delivery cost for one neighborhood: w_i * d_eff * rate_eff."""
    return float(w_i) * effective_distance(d_km, config, congestion) * effective_rate(config, prices)


def compute_metrics(
    neighborhoods: List[Dict[str, Any]],
    assignments: List[Assignment],
    warehouses: List[Warehouse],
    config: OptimizationConfig,
    prices: Optional[Dict[str, float]] = None,
    fuel_live: bool = False,
) -> Metrics:
    """Aggregate Metrics from per-assignment distances (distances are raw km)."""
    if prices is None:
        prices, fuel_live, _ = resolve_fuel_prices(config)
    total_unweighted = 0.0
    total_weighted = 0.0
    total_cost = 0.0
    total_fuel = 0.0
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
        total_fuel += assignment_fuel_cost(w_i, float(a.distance_km), config, prices,
                                           a.congestion_pct)
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
    congs = [float(a.congestion_pct) for a in assignments if a.congestion_pct is not None]
    return Metrics(
        total_unweighted_distance_km=round(total_unweighted, 2),
        total_weighted_distance_km_orders=round(total_weighted, 2),
        total_cost=round(total_cost, 2),
        total_fuel_cost=round(total_fuel, 2),
        fuel_live=fuel_live,
        avg_congestion_pct=round(sum(congs) / len(congs), 4) if congs else 0.0,
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
        ("total_fuel_cost", baseline.total_fuel_cost, optimized.total_fuel_cost),
        ("avg_congestion_pct", baseline.avg_congestion_pct, optimized.avg_congestion_pct),
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
