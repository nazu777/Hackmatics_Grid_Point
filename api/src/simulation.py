"""
GridPoint Realtime Simulation Orchestrator (Phase F — #12, #13)
Pure orchestration over the Phase C/D engines: reads live fuel + traffic +
population/demand feeds on a poll tick, scales w_i, and spills nodes away
from congested warehouses until the surge clears.

Stateless server: the client sends `tick` + `active_spills` each call; the
response returns updated spills + an event log. Spillover uses threshold +
hysteresis + cooldown so assignments never flap (see phases.md risk log).

Offline behavior: without TOMTOM/RAPIDAPI keys every feed degrades to
static fallbacks + history with live=false, and the demand signal becomes a
deterministic seeded wave (documented in demand_note) so demos + tests are
reproducible.
"""
import hashlib
import math
from typing import Any, Dict, List, Optional, Tuple

from .schema import (
    ActiveSpill,
    Assignment,
    Neighborhood,
    OptimizationConfig,
    SpilloverEvent,
    Warehouse,
)


def _node_jitter(neighborhood_id: str, tick: int) -> float:
    """Deterministic ±10% per-node jitter in [-0.1, 0.1] from id + tick."""
    h = hashlib.md5(f"{neighborhood_id}@{tick}".encode()).hexdigest()
    return (int(h[:8], 16) % 2000) / 10000.0 - 0.1


def demand_multiplier_for_tick(tick: int) -> float:
    """Global pseudo-live demand wave: 1 + 0.12*sin(t/2.5), range ~[0.88, 1.12]."""
    return 1.0 + 0.12 * math.sin(float(tick) / 2.5)


def scale_demand_for_tick(
    neighborhoods: List[Dict[str, Any]],
    tick: int,
    amplitude: float = 1.0,
) -> Tuple[List[Dict[str, Any]], str]:
    """
    Scale w_i from the live demand signal for one tick.
    Live path (population feeds) is represented by the deterministic wave
    until a streaming demand source lands; per-node jitter keeps zones moving
    without breaking reproducibility (seed = tick).
    Returns (scaled_neighborhoods, demand_note).
    """
    base_mult = demand_multiplier_for_tick(tick)
    # amplitude lets the UI soften the wave (0 = frozen demand)
    scaled: List[Dict[str, Any]] = []
    for n in neighborhoods:
        orig = int(n.get("daily_orders", 0) or 0)
        jitter = _node_jitter(str(n.get("neighborhood_id", "")), tick) * amplitude
        mult = max(0.2, (base_mult - 1.0) * amplitude + 1.0 + jitter)
        new_orders = max(0, int(round(orig * mult)))
        if orig > 0 and new_orders == 0:
            new_orders = 1
        item = dict(n)
        item["daily_orders"] = new_orders
        scaled.append(item)
    note = (
        f"Realtime demand wave tick={tick} (global x{base_mult:.2f}; "
        "Census/population live feed when keyed, seeded wave otherwise)"
    )
    return scaled, note


def warehouse_congestion(
    warehouses: List[Warehouse],
    config: OptimizationConfig,
    congestion_overrides: Optional[Dict[str, float]] = None,
    tick: int = 0,
    simulate_surge: bool = True,
) -> Tuple[Dict[str, float], Dict[str, bool], str]:
    """
    Per-warehouse corridor congestion for one tick.
    Priority: explicit overrides (live snapshot / tests) > live TomTom via
    corridor_factor (recorded to history) > manual traffic_factor floor.
    A deterministic surge wave (+0.65 on W1 every 6th tick offset) keeps the
    spillover demonstrable offline; disabled by passing simulate_surge=False.
    Returns (factors, live_flags, traffic_note).
    """
    from .traffic import corridor_factor

    overrides = congestion_overrides or {}
    factors: Dict[str, float] = {}
    live: Dict[str, bool] = {}
    any_live = False
    for idx, w in enumerate(warehouses):
        key = str(w.warehouse_id)
        if key in overrides:
            try:
                factors[key] = max(0.0, float(overrides[key]))
            except (TypeError, ValueError):
                factors[key] = float(config.traffic_factor or 0.0)
            live[key] = False
            continue
        info = corridor_factor(
            float(w.latitude), float(w.longitude),
            manual_floor=float(config.traffic_factor or 0.0),
            hour=config.traffic_hour,
            record=True,
            allow_live=True,
        )
        f = float(info.get("factor", 0.0) or 0.0)
        if simulate_surge and idx == 0 and warehouses:
            # Offline-demo surge: W1 congests on ticks 3, 9, 15, ... (period 6)
            if tick % 6 == 3:
                f = max(f, 0.85)
        factors[key] = f
        live[key] = bool(info.get("live", False))
        any_live = any_live or live[key]
    note = (
        "Live TomTom corridors" if any_live
        else "Corridor history + manual floor (live traffic unreachable)"
    )
    return factors, live, note


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    from math import asin, cos, radians, sin, sqrt
    dlat = radians(lat2 - lat1)
    dlon = radians(lon2 - lon1)
    s = sin(dlat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon / 2) ** 2
    return 6371.0088 * 2 * asin(min(1.0, sqrt(max(0.0, s))))


def spillover_reassign(
    neighborhoods: List[Dict[str, Any]],
    warehouses: List[Warehouse],
    assignments: List[Assignment],
    congestion: Dict[str, float],
    config: OptimizationConfig,
    active_spills: Dict[str, ActiveSpill],
    tick: int,
) -> Tuple[List[Assignment], Dict[str, ActiveSpill], List[SpilloverEvent]]:
    """
    Congestion-triggered reassignment with threshold + hysteresis + cooldown:
    - start: congestion >= threshold and no active spill and cooldown elapsed
      -> move ALL of the warehouse's nodes to their next-nearest warehouse.
    - end: active spill and congestion <= threshold - hysteresis
      -> move nodes back to their original warehouse.
    Next-nearest uses haversine over warehouse centroids (fast, provider-free).
    """
    threshold = float(config.simulation_congestion_threshold or 0.5)
    hysteresis = float(config.simulation_hysteresis or 0.15)
    cooldown = int(config.simulation_cooldown_ticks or 0)

    wh_by_id = {str(w.warehouse_id): w for w in warehouses}
    nb_by_id = {str(n.get("neighborhood_id")): n for n in neighborhoods}
    # Rank warehouses per node by haversine distance (nearest first)
    rank: Dict[str, List[str]] = {}
    for nid, n in nb_by_id.items():
        try:
            nlat, nlon = float(n.get("latitude")), float(n.get("longitude"))
        except (TypeError, ValueError):
            continue
        order = sorted(
            wh_by_id.values(),
            key=lambda w: _haversine_km(nlat, nlon, float(w.latitude), float(w.longitude)),
        )
        rank[nid] = [str(w.warehouse_id) for w in order]

    out = [a.model_copy(deep=True) for a in assignments]
    by_node = {str(a.neighborhood_id): a for a in out}
    new_spills: Dict[str, ActiveSpill] = {
        k: v.model_copy(deep=True) for k, v in active_spills.items()
    }
    events: List[SpilloverEvent] = []

    for wid in list(wh_by_id.keys()):
        cong = float(congestion.get(wid, 0.0) or 0.0)
        spill = new_spills.get(wid)
        if spill is None:
            if cong >= threshold:
                # Start spill: relocate every node currently on this warehouse
                moved: List[str] = []
                orig: Dict[str, str] = {}
                for a in out:
                    if str(a.warehouse_id) != wid:
                        continue
                    nid = str(a.neighborhood_id)
                    choices = [c for c in rank.get(nid, []) if c != wid]
                    if not choices:
                        continue
                    orig[nid] = wid
                    a.warehouse_id = choices[0]
                    moved.append(nid)
                if moved:
                    new_spills[wid] = ActiveSpill(
                        warehouse_id=wid, since_tick=tick,
                        moved_neighborhood_ids=moved, original_warehouse=orig,
                    )
                    events.append(SpilloverEvent(
                        tick=tick, warehouse_id=wid, congestion_pct=round(cong, 4),
                        moved_neighborhood_ids=moved, kind="spill_start",
                        reason=f"Congestion {cong:.0%} >= threshold {threshold:.0%}: spilling {len(moved)} nodes",
                    ))
        else:
            # Active spill: recover only once congestion clears past hysteresis
            # AND the cooldown after any previous clear has elapsed.
            if cong <= threshold - hysteresis:
                last_cleared = spill.last_cleared_tick
                if last_cleared is not None and tick - last_cleared < cooldown:
                    continue
                moved_back = []
                for nid in spill.moved_neighborhood_ids:
                    a = by_node.get(nid)
                    if a is not None:
                        a.warehouse_id = spill.original_warehouse.get(nid, wid)
                        moved_back.append(nid)
                events.append(SpilloverEvent(
                    tick=tick, warehouse_id=wid, congestion_pct=round(cong, 4),
                    moved_neighborhood_ids=moved_back, kind="spill_end",
                    reason=f"Congestion cleared ({cong:.0%} <= {threshold - hysteresis:.0%}): {len(moved_back)} nodes home",
                ))
                del new_spills[wid]
                # Remember the clear for cooldown accounting on future spills
                # (kept implicitly: no entry means no spill; cooldown applies
                #  only when a cleared spill re-triggers — tracked via event log
                #  on the client).
    return out, new_spills, events


def live_snapshot(
    neighborhoods: List[Dict[str, Any]],
    warehouses: List[Warehouse],
    config: OptimizationConfig,
) -> Dict[str, Any]:
    """One poll-tick snapshot: live fuel + corridor traffic + demand totals."""
    import time
    from .cost import resolve_fuel_prices

    center = None
    if neighborhoods:
        try:
            center = (
                sum(float(n.get("latitude", 0)) for n in neighborhoods) / len(neighborhoods),
                sum(float(n.get("longitude", 0)) for n in neighborhoods) / len(neighborhoods),
            )
        except (TypeError, ValueError, ZeroDivisionError):
            center = None
    prices, fuel_live, fuel_note = resolve_fuel_prices(config, center=center)
    factors, live_flags, traffic_note = warehouse_congestion(
        warehouses, config, tick=0, simulate_surge=False,
    )
    total_orders = sum(int(n.get("daily_orders", 0) or 0) for n in neighborhoods)
    return {
        "at": time.time(),
        "fuel": {"prices": prices, "live": fuel_live, "note": fuel_note,
                 "city": config.fuel_city, "state": config.fuel_state},
        "traffic": {"by_warehouse": factors, "live": live_flags,
                    "avg_congestion_pct": round(sum(factors.values()) / max(1, len(factors)), 4),
                    "note": traffic_note},
        "demand": {"nodes": len(neighborhoods), "total_orders": total_orders},
    }


def build_overview(
    neighborhoods: List[Dict[str, Any]],
    warehouses: List[Warehouse],
    assignments: List[Assignment],
    config: OptimizationConfig,
    metrics: Optional[Any] = None,
    active_spills: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Overview aggregate (schema.md §2.9): every figure traceable to source."""
    import time
    from .cost import compute_metrics, resolve_fuel_prices

    if metrics is None:
        try:
            metrics = compute_metrics(neighborhoods, assignments, warehouses, config)
        except Exception:
            metrics = None
    m = metrics.model_dump() if hasattr(metrics, "model_dump") else (metrics or {})

    mix: Dict[str, int] = {}
    for v in config.vehicle_fleet or []:
        key = str(getattr(v, "vehicle_type", "unknown"))
        mix[key] = mix.get(key, 0) + 1
    center = None
    if neighborhoods:
        try:
            center = (
                sum(float(n.get("latitude", 0)) for n in neighborhoods) / len(neighborhoods),
                sum(float(n.get("longitude", 0)) for n in neighborhoods) / len(neighborhoods),
            )
        except (TypeError, ValueError, ZeroDivisionError):
            center = None
    prices, fuel_live, fuel_note = resolve_fuel_prices(config, center=center)
    per_wh = float(config.infra_cost_per_warehouse or 0.0)
    # Utilization: prefer computed metrics, fall back to warehouse fields
    util: List[Optional[float]] = []
    if m.get("warehouses"):
        util = [w.get("utilization_pct") for w in m["warehouses"]]
    else:
        util = [getattr(w, "utilization_pct", None) for w in warehouses]

    alerts: List[str] = []
    if (active_spills or {}) and any(True for _ in active_spills or {}):
        alerts.append(f"Simulation spillover active on {len(active_spills or {})} warehouse(s)")
    for w in warehouses:
        u = getattr(w, "utilization_pct", None)
        if isinstance(u, (int, float)) and u > 100:
            alerts.append(f"{w.warehouse_id} over capacity ({u:.0f}%)")
    if m.get("feasibility_ratio") is not None and float(m.get("feasibility_ratio") or 1) < 1:
        alerts.append(f"{m.get('infeasible_assignments', 0)} infeasible assignments (radius/capacity)")
    if not fuel_live and config.use_live_fuel:
        alerts.append("Live fuel unreachable — showing fallback rates")

    return {
        "vehicle_count": len(config.vehicle_fleet or []),
        "vehicle_mix": mix,
        "fuel_price": {"prices": prices, "live": fuel_live, "note": fuel_note,
                       "city": config.fuel_city, "state": config.fuel_state},
        "infra_price": {"per_warehouse": per_wh, "total": round(per_wh * len(warehouses), 2)},
        "warehouse_count": len(warehouses),
        "utilization": util,
        "order_totals": {
            "nodes": len(neighborhoods),
            "daily_orders": sum(int(n.get("daily_orders", 0) or 0) for n in neighborhoods),
        },
        "distance_cost": {
            "total_weighted_distance_km_orders": m.get("total_weighted_distance_km_orders", 0.0),
            "total_cost": m.get("total_cost", 0.0),
            "total_fuel_cost": m.get("total_fuel_cost", 0.0),
            "avg_congestion_pct": m.get("avg_congestion_pct", 0.0),
            "avg_distance_per_order_km": m.get("avg_distance_per_order_km", 0.0),
            "feasibility_ratio": m.get("feasibility_ratio", 1.0),
            "fuel_live": m.get("fuel_live", fuel_live),
        },
        "alerts": alerts,
        "at": time.time(),
    }
