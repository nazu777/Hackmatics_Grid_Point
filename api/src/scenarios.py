"""
GridPoint Advanced Scenarios & Bonus Engine (Phase 5)
Implements bonus features from docs/problem_statement.md:
  1. Infrastructure vs Delivery cost trade-off (Elbow curve over K)
  2. Customer demand shift simulator (w_i' = w_i * (1 + delta%))
  3. Traffic congestion & Vehicle fleet delivery ETA calculator
  4. Warehouse capacity utilization & radius violation diagnostics
"""
import copy
import math
from typing import Any, Dict, List, Optional, Tuple

from .cost import effective_distance, effective_rate
from .optimization import run_optimization
from .schema import (
    Assignment,
    OptimizationConfig,
    OptimizationResult,
    VehicleType,
    Warehouse,
)


def compute_tradeoff_curve(
    neighborhoods: List[Dict[str, Any]],
    base_config: OptimizationConfig,
    max_k: int = 6,
) -> Dict[str, Any]:
    """
    Computes delivery vs infrastructure cost trade-off curve across K in [1, min(max_k, N)].
    Finds the optimal number of warehouses (elbow / cost-minimizing K).
    """
    if not neighborhoods:
        return {"points": [], "optimal_K": 1, "min_cost": 0.0}

    max_k_eval = max(1, min(max_k, len(neighborhoods), 10))
    points: List[Dict[str, Any]] = []
    best_k = 1
    min_total_cost = float("inf")

    infra_per_wh = float(base_config.infra_cost_per_warehouse or 0.0)

    for k in range(1, max_k_eval + 1):
        cfg = base_config.model_copy(deep=True)
        cfg.K = k
        # We compute clean optimization for each K
        opt_res = run_optimization(neighborhoods, cfg)

        # Separate delivery cost from infrastructure cost
        # total_cost in opt_res.metrics includes infra_cost = K * infra_per_wh
        total_infra = k * infra_per_wh
        total_delivery = sum(float(a.cost) for a in opt_res.assignments)
        total_cost = total_delivery + total_infra

        avg_dist = float(opt_res.metrics.avg_distance_per_order_km)
        pct_saved = (
            float(opt_res.comparison.delta.pct_cost_saved)
            if opt_res.comparison
            else 0.0
        )

        pt = {
            "K": k,
            "delivery_cost": round(total_delivery, 2),
            "infra_cost": round(total_infra, 2),
            "total_cost": round(total_cost, 2),
            "avg_distance_km": round(avg_dist, 2),
            "pct_cost_saved": round(pct_saved, 1),
            "is_feasible": opt_res.is_feasible,
        }
        points.append(pt)

        if total_cost < min_total_cost:
            min_total_cost = total_cost
            best_k = k

    return {
        "points": points,
        "optimal_K": best_k,
        "min_cost": round(min_total_cost, 2) if min_total_cost != float("inf") else 0.0,
    }


def simulate_demand_shift(
    neighborhoods: List[Dict[str, Any]],
    pct_delta: float,
) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    """
    Simulates demand shift w_i' = round(w_i * (1 + pct_delta / 100)).
    Enforces daily_orders >= 0 and at least 1 if original > 0.
    Returns (shifted_neighborhoods, summary_stats).
    """
    multiplier = 1.0 + (float(pct_delta) / 100.0)
    shifted: List[Dict[str, Any]] = []

    original_total = 0
    new_total = 0

    for n in neighborhoods:
        orig_orders = int(n.get("daily_orders", 0))
        original_total += orig_orders

        new_orders = max(0, int(round(orig_orders * multiplier)))
        if orig_orders > 0 and new_orders == 0 and multiplier > 0:
            new_orders = 1

        new_total += new_orders

        item = copy.deepcopy(n)
        item["daily_orders"] = new_orders
        item["_original_daily_orders"] = orig_orders
        shifted.append(item)

    stats = {
        "pct_delta": round(pct_delta, 1),
        "original_total_orders": original_total,
        "new_total_orders": new_total,
        "net_order_change": new_total - original_total,
        "actual_pct_change": round(((new_total - original_total) / max(1, original_total)) * 100.0, 1),
    }

    return shifted, stats


def calculate_fleet_eta(
    assignments: List[Assignment],
    config: OptimizationConfig,
    vehicle_type: Optional[str] = None,
    warehouses: Optional[List[Any]] = None,
    use_live_feeds: Optional[bool] = None,
    congestion_overrides: Optional[Dict[str, float]] = None,
) -> Dict[str, Any]:
    """
    Computes ETA and fleet metrics:
    time_min = (d_eff / avg_speed_kmph) * 60

    Phase C (#12 engine half): the engine path reads live fuel + traffic
    feeds with no manual slider required. Per-assignment congestion_pct wins
    when present (it already carries live corridor readings from
    optimization); when absent and live feeds are enabled, corridor factors
    are resolved per warehouse (overrides > live TomTom > history > manual
    floor). The manual traffic_factor survives only as an offline floor.
    """
    if not assignments:
        return {
            "avg_eta_minutes": 0.0,
            "max_eta_minutes": 0.0,
            "total_trips": 0,
            "fuel_consumed_liters": 0.0,
            "vehicle_used": "Standard Fleet",
        }

    # Find chosen vehicle or default
    vehicle: Optional[VehicleType] = None
    if config.vehicle_fleet:
        if vehicle_type:
            vehicle = next((v for v in config.vehicle_fleet if v.vehicle_type.lower() == vehicle_type.lower()), None)
        if not vehicle:
            vehicle = config.vehicle_fleet[0]

    speed_kmph = vehicle.avg_speed_kmph if (vehicle and vehicle.avg_speed_kmph) else 35.0
    capacity = vehicle.capacity if (vehicle and vehicle.capacity) else 100
    v_name = vehicle.vehicle_type if vehicle else "Standard Van"

    traffic = float(config.traffic_factor or 0.0)

    # Phase C live-feed resolution for assignments missing congestion.
    live_mode = (bool(getattr(config, "use_live_traffic", False)
                      or getattr(config, "use_live_traffic_for_routing", False))
                 if use_live_feeds is None else bool(use_live_feeds))
    overrides = dict(congestion_overrides or {})
    wh_factor: Dict[str, float] = {}
    traffic_live_any = False
    congestion_source = "manual"
    needs_live = live_mode and any(
        getattr(a, "congestion_pct", None) is None for a in assignments)
    if needs_live:
        try:
            from .traffic import corridor_factor
            wh_list = list(warehouses or [])
            # When no warehouse list is given, derive one site per assignment
            # warehouse_id from the assignment's own distance (history-only).
            if wh_list:
                for w in wh_list:
                    wid = str(getattr(w, "warehouse_id", "") if not isinstance(w, dict)
                              else w.get("warehouse_id", ""))
                    if not wid:
                        continue
                    if wid in overrides:
                        wh_factor[wid] = max(0.0, float(overrides[wid]))
                        continue
                    try:
                        lat = float(getattr(w, "latitude") if not isinstance(w, dict)
                                    else w.get("latitude"))
                        lon = float(getattr(w, "longitude") if not isinstance(w, dict)
                                    else w.get("longitude"))
                    except (TypeError, ValueError):
                        continue
                    info = corridor_factor(lat, lon, manual_floor=traffic,
                                           hour=config.traffic_hour, record=True,
                                           allow_live=True)
                    wh_factor[wid] = float(info.get("factor", traffic) or traffic)
                    traffic_live_any = traffic_live_any or bool(info.get("live", False))
                congestion_source = ("live" if traffic_live_any
                                     else ("history" if wh_factor else "manual"))
            else:
                for a in assignments:
                    wid = str(getattr(a, "warehouse_id", ""))
                    if wid in overrides and wid not in wh_factor:
                        wh_factor[wid] = max(0.0, float(overrides[wid]))
                congestion_source = "manual" if not wh_factor else "override"
        except Exception:
            wh_factor = {}
            congestion_source = "manual"

    etas: List[float] = []
    total_trips = 0
    total_effective_km = 0.0

    from .cost import corridor_congestion
    applied_congs: List[float] = []
    for a in assignments:
        base_cong = getattr(a, "congestion_pct", None)
        if base_cong is None and str(getattr(a, "warehouse_id", "")) in wh_factor:
            base_cong = wh_factor[str(getattr(a, "warehouse_id", ""))]
            if congestion_source == "manual":
                congestion_source = "history"
        cong = corridor_congestion(config, base_cong)
        applied_congs.append(cong)
        d_eff = float(a.distance_km) * (1.0 + cong)
        total_effective_km += d_eff
        time_hours = d_eff / max(5.0, speed_kmph)
        etas.append(time_hours * 60.0)

        # Trips based on capacity (order volume approx from weighted distance / dist)
        approx_orders = max(1, int(round(a.weighted_distance / max(0.01, a.distance_km)))) if a.distance_km > 0 else 1
        trips = math.ceil(approx_orders / max(1, capacity))
        total_trips += trips

    avg_eta = sum(etas) / max(1, len(etas))
    max_eta = max(etas) if etas else 0.0
    # Approx fuel consumption: 8L/100km vans, 3L/100km bikes, 22L/100km trucks
    fuel_rate_per_km = 0.08
    if "bike" in v_name.lower():
        fuel_rate_per_km = 0.03
    elif "truck" in v_name.lower():
        fuel_rate_per_km = 0.20
    elif "electric" in v_name.lower():
        fuel_rate_per_km = 0.00  # electric (kWh modeled separately)
    if vehicle and vehicle.mileage_kmpl and vehicle.mileage_kmpl > 0:
        fuel_rate_per_km = 1.0 / vehicle.mileage_kmpl

    fuel_consumed = total_effective_km * fuel_rate_per_km

    # Live fuel price for this vehicle's fuel type (cached; falls back offline)
    from .cost import resolve_fuel_prices
    fuel_prices, fuel_live, fuel_note = resolve_fuel_prices(config)
    fuel_type = (vehicle.fuel_type if vehicle and vehicle.fuel_type else "petrol").strip().lower()
    fuel_price = fuel_prices.get(fuel_type)
    fuel_cost = round(fuel_consumed * fuel_price, 2) if fuel_price is not None else 0.0

    return {
        "avg_eta_minutes": round(avg_eta, 1),
        "max_eta_minutes": round(max_eta, 1),
        "total_trips": total_trips,
        "effective_km": round(total_effective_km, 1),
        "fuel_consumed_liters": round(fuel_consumed, 1),
        "fuel_price_per_litre": fuel_price,
        "fuel_type": fuel_type,
        "fuel_cost": fuel_cost,
        "fuel_live": fuel_live,
        "fuel_note": fuel_note,
        "vehicle_used": v_name,
        "avg_speed_kmph": speed_kmph,
        "traffic_congestion_pct": round(traffic * 100.0, 1),
        "congestion_source": congestion_source,
        "traffic_live": traffic_live_any,
        "effective_congestion_pct": round(
            (sum(applied_congs) / len(applied_congs) * 100.0) if applied_congs else 0.0, 1),
    }


def diagnose_constraints(
    warehouses: List[Warehouse],
    assignments: List[Assignment],
    config: OptimizationConfig,
) -> Dict[str, Any]:
    """
    Performs deep diagnostics on capacity and radius constraints:
    - Identifies capacity overflow per warehouse
    - Identifies radius violations per assignment
    - Calculates severity score
    """
    capacity_violations: List[Dict[str, Any]] = []
    radius_violations: List[Dict[str, Any]] = []

    c_max = config.C_max if (config.capacity_enabled and config.C_max) else None
    r_max = config.R_max_km if (config.radius_enabled and config.R_max_km) else None

    # Capacity check
    for w in warehouses:
        assigned = int(w.assigned_orders or 0)
        utilization = w.utilization_pct or (round(assigned / c_max * 100.0, 1) if c_max else None)

        if c_max and assigned > c_max:
            overflow = assigned - c_max
            capacity_violations.append({
                "warehouse_id": w.warehouse_id,
                "assigned_orders": assigned,
                "capacity": c_max,
                "overflow_orders": overflow,
                "utilization_pct": utilization,
                "severity": "CRITICAL" if overflow > (0.25 * c_max) else "WARNING",
            })

    # Radius check
    for a in assignments:
        dist = float(a.distance_km)
        if r_max and dist > r_max:
            overage = dist - r_max
            radius_violations.append({
                "neighborhood_id": a.neighborhood_id,
                "warehouse_id": a.warehouse_id,
                "distance_km": round(dist, 2),
                "r_max_km": round(r_max, 2),
                "overage_km": round(overage, 2),
                "severity": "CRITICAL" if overage > 10.0 else "WARNING",
            })

    is_compliant = len(capacity_violations) == 0 and len(radius_violations) == 0

    return {
        "is_compliant": is_compliant,
        "capacity_enabled": bool(config.capacity_enabled),
        "radius_enabled": bool(config.radius_enabled),
        "capacity_violations": capacity_violations,
        "radius_violations": radius_violations,
        "total_violations": len(capacity_violations) + len(radius_violations),
    }
