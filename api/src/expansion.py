"""
GridPoint Incremental Warehouse Expansion.

Adds new warehouses to an EXISTING layout without removing or moving the
current ones. New sites are placed to either:
  1. relieve the heaviest-loaded warehouses (highest assigned demand), or
  2. serve areas the current network reaches poorly (nodes outside R_max,
     or the farthest/highest-cost nodes of overloaded sites).

After siting, every neighborhood is reassigned to its nearest warehouse
(serving locations may change), and the expanded layout is evaluated with
the shared cost engine so before/after numbers are directly comparable.
"""
from typing import List, Dict, Any, Tuple, Optional
import numpy as np

from .schema import (
    OptimizationConfig,
    OptimizationResult,
    LayoutEvaluation,
)
from .distance import compute_distance_matrix
from .cost import compute_comparison, resolve_fuel_prices
from .optimization import (
    evaluate_network_layout,
    weiszfeld_geometric_median,
    nearest_labels_for_metric,
)

MAX_WAREHOUSES = 10

# ---------------------------------------------------------------------------
# Phase E — Expansion policy + NPV recommendation (backlog #11)
# ---------------------------------------------------------------------------
# Policy toggles (schema.md §2.4 expansion_policy, planned):
#   allow_abandon_infra: keep vs abandon/change/demolish current sites
#   allow_sell_vehicles: keep vs sell already-owned vehicles
#   horizon_months: economics horizon for delivery/fuel/revenue math
#   revenue_per_order: future revenue per order served over the horizon
# Friction/pricing knobs (all optional, default 0 = no friction):
#   demolition_cost / salvage_value per abandoned site,
#   resale_value flat proceeds when selling vehicles,
#   infra_cost_new per new site (defaults to config.infra_cost_per_warehouse).
# NPV per option (ranked, ONE winner):
#   npv = delivery_saved + revenue_enabled - capex_new - frictions + proceeds
# where delivery_saved = (before - after) monthly delivery × horizon,
# revenue_enabled = revenue_per_order × orders × horizon × feasibility_after
# (incremental vs before), capex_new = infra_cost_new × added.
# All delivery/fuel inputs come from the shared Phase-D cost engine so the
# recommendation reconciles to ComparisonDashboard figures row-for-row.

DEFAULT_POLICY: Dict[str, Any] = {
    "allow_abandon_infra": False,
    "allow_sell_vehicles": False,
    "horizon_months": 12,
    "revenue_per_order": 0.0,
    "demolition_cost": 0.0,
    "salvage_value": 0.0,
    "resale_value": 0.0,
    "infra_cost_new": None,
    "vehicle_cost_new": 0.0,
}


def normalize_policy(policy: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Merge a caller policy dict over DEFAULT_POLICY with sane clamps."""
    merged: Dict[str, Any] = dict(DEFAULT_POLICY)
    if policy:
        for k, v in policy.items():
            if k in merged:
                merged[k] = v
    merged["allow_abandon_infra"] = bool(merged.get("allow_abandon_infra", False))
    merged["allow_sell_vehicles"] = bool(merged.get("allow_sell_vehicles", False))
    try:
        merged["horizon_months"] = max(1, min(120, int(merged.get("horizon_months", 12) or 12)))
    except (TypeError, ValueError):
        merged["horizon_months"] = 12
    for f in ("revenue_per_order", "demolition_cost", "salvage_value",
              "resale_value", "vehicle_cost_new"):
        try:
            merged[f] = max(0.0, float(merged.get(f, 0.0) or 0.0))
        except (TypeError, ValueError):
            merged[f] = 0.0
    infra_new = merged.get("infra_cost_new", None)
    try:
        merged["infra_cost_new"] = max(0.0, float(infra_new)) if infra_new is not None else None
    except (TypeError, ValueError):
        merged["infra_cost_new"] = None
    return merged


def _horizon_npv(before_m: Any, after_m: Any, total_orders: int,
                 policy: Dict[str, Any], added: int, infra_each: float,
                 friction: float = 0.0, proceeds: float = 0.0) -> Dict[str, float]:
    """Score one candidate layout over the policy horizon (all Phase-D figures)."""
    horizon = int(policy["horizon_months"])
    delivery_saved_m = float(before_m.total_cost) - float(after_m.total_cost)
    fuel_saved_m = float(before_m.total_fuel_cost) - float(after_m.total_fuel_cost)
    delivery_saved = delivery_saved_m * horizon
    fuel_saved = fuel_saved_m * horizon
    rev_rate = float(policy["revenue_per_order"])
    revenue = rev_rate * total_orders * horizon * float(after_m.feasibility_ratio or 0.0)
    revenue_before = rev_rate * total_orders * horizon * float(before_m.feasibility_ratio or 0.0)
    revenue_enabled = revenue - revenue_before
    capex = infra_each * added + float(policy.get("vehicle_cost_new", 0.0) or 0.0)
    npv = delivery_saved + revenue_enabled - capex - friction + proceeds
    return {
        "infra": round(capex, 2),
        "fuel": round(float(after_m.total_fuel_cost) * horizon, 2),
        "fuel_saved": round(fuel_saved, 2),
        "delivery_saved": round(delivery_saved, 2),
        "revenue": round(revenue_enabled, 2),
        "friction": round(friction, 2),
        "proceeds": round(proceeds, 2),
        "npv": round(npv, 2),
    }


def _siting_metric(config: OptimizationConfig) -> str:
    """Distance metric for greedy siting (road matrices stay in evaluation)."""
    m = (config.distance_metric or "haversine").lower().strip()
    return m if m in ("haversine", "euclidean", "manhattan") else "haversine"


def _nearest_labels(dist_matrix: np.ndarray) -> np.ndarray:
    return np.argmin(dist_matrix, axis=1)


def _pick_donor_site(
    labels: np.ndarray,
    weights: np.ndarray,
    dist_matrix: np.ndarray,
    r_max: Optional[float],
) -> int:
    """
    Choose which current site most needs relief: the site covering the most
    out-of-radius nodes first, otherwise the site with the highest load.
    """
    n_sites = dist_matrix.shape[1]
    assigned_dist = dist_matrix[np.arange(len(labels)), labels]
    if r_max is not None and r_max > 0:
        infeasible = (assigned_dist > r_max).astype(int)
        per_site_bad = np.bincount(labels, weights=infeasible, minlength=n_sites)
        if per_site_bad.max() > 0:
            return int(np.argmax(per_site_bad))
    per_site_load = np.bincount(labels, weights=weights, minlength=n_sites)
    return int(np.argmax(per_site_load))


def _relief_subset(
    donor: int,
    labels: np.ndarray,
    weights: np.ndarray,
    dist_matrix: np.ndarray,
) -> np.ndarray:
    """
    Nodes the new warehouse should take over: the donor's worst-served half
    by distance (ties broken toward higher demand), at least one node.
    """
    idx = np.where(labels == donor)[0]
    if len(idx) <= 1:
        return idx
    d = dist_matrix[idx, donor]
    order = np.lexsort((-weights[idx], d))  # distance asc, weight desc
    cut = max(1, len(idx) // 2)
    return idx[order[-cut:]]


def _evaluate_sites(
    neighborhoods: List[Dict[str, Any]],
    site_coords: np.ndarray,
    config: OptimizationConfig,
    fuel_prices: Optional[Dict[str, float]],
    fuel_live: bool,
) -> Tuple[Any, Any, Any]:
    """Evaluate an arbitrary site set with the shared Phase-D cost engine."""
    coords = np.array(
        [[float(n["latitude"]), float(n["longitude"])] for n in neighborhoods]
    )
    metric = _siting_metric(config)
    true_metric = (config.distance_metric or "haversine").lower().strip()
    live_traffic = bool(getattr(config, "use_live_traffic", False))
    if true_metric == "road":
        labels = nearest_labels_for_metric(
            coords, site_coords, "road", live_traffic=live_traffic)
    else:
        labels = _nearest_labels(
            compute_distance_matrix(coords, site_coords, metric=metric))
    return evaluate_network_layout(
        neighborhoods, site_coords, labels, config,
        fuel_prices=fuel_prices, fuel_live=fuel_live,
    )


def build_recommendation(
    neighborhoods: List[Dict[str, Any]],
    existing_warehouses: List[Dict[str, Any]],
    keep: Dict[str, Any],
    config: OptimizationConfig,
    policy: Dict[str, Any],
    fuel_prices: Optional[Dict[str, float]],
    fuel_live: bool,
) -> Dict[str, Any]:
    """Rank keep / abandon / sell candidates by NPV and return ONE winner.

    `keep` carries the greedy keep-all+add layout (before/after metrics).
    Toggles gate candidates: abandon options exist only when
    allow_abandon_infra is set, sell variants only when allow_sell_vehicles
    is set — so flipping a toggle flips the recommendation whenever the
    gated option wins on NPV.
    """
    total_orders = sum(int(n.get("daily_orders", 0) or 0) for n in neighborhoods)
    before_m = keep["before_metrics"]
    after_m = keep["after_metrics"]
    added = int(keep["added"])
    infra_each = policy["infra_cost_new"]
    if infra_each is None:
        infra_each = float(config.infra_cost_per_warehouse or 0.0)

    options: List[Dict[str, Any]] = []

    def _dump(wh: Any, asg: Any, m: Any) -> Dict[str, Any]:
        return {
            "warehouses": [w.model_dump() for w in wh],
            "assignments": [a.model_dump() for a in asg],
            "metrics": m.model_dump(),
        }

    # Option 1 — keep everything, add N new (always available).
    eco_keep = _horizon_npv(before_m, after_m, total_orders, policy,
                            added, infra_each)
    options.append({
        "plan": f"keep-all + {added} new site(s)",
        "new_warehouses": list(keep["new_ids"]),
        "abandoned_infra": [],
        "sold_vehicles": [],
        "added": added,
        **eco_keep,
        "layout": _dump(keep["after_wh"], keep["after_asg"], after_m),
    })

    # Option 2 — abandon the lightest-loaded current site, keep the new ones.
    if policy["allow_abandon_infra"] and len(existing_warehouses) >= 2:
        loads = {r["warehouse_id"]: int(r["before_orders"]) for r in keep["relief"]}
        drop_id = min(loads, key=lambda k: loads[k])
        drop_idx = next(
            (i for i, w in enumerate(existing_warehouses)
             if str(w.get("warehouse_id", f"W{i+1}")) == drop_id), 0)
        kept = [s for i, s in enumerate(keep["sites_after"].tolist())
                if not (i == drop_idx)]
        # keep at least one existing site + the new ones
        if len(kept) >= 1:
            ab_wh, ab_asg, ab_m = _evaluate_sites(
                neighborhoods, np.array(kept), config, fuel_prices, fuel_live)
            friction = float(policy["demolition_cost"])
            proceeds = float(policy["salvage_value"])
            eco_ab = _horizon_npv(before_m, ab_m, total_orders, policy,
                                  added, infra_each,
                                  friction=friction, proceeds=proceeds)
            options.append({
                "plan": f"abandon {drop_id} + {added} new site(s)",
                "new_warehouses": list(keep["new_ids"]),
                "abandoned_infra": [drop_id],
                "sold_vehicles": [],
                "added": added,
                **eco_ab,
                "layout": _dump(ab_wh, ab_asg, ab_m),
            })

    # Option 3 — keep-all layout, sell vehicles for one-time proceeds.
    if policy["allow_sell_vehicles"] and float(policy["resale_value"]) > 0:
        eco_sell = _horizon_npv(before_m, after_m, total_orders, policy,
                                added, infra_each,
                                proceeds=float(policy["resale_value"]))
        options.append({
            "plan": f"keep-all + {added} new site(s) + sell vehicles",
            "new_warehouses": list(keep["new_ids"]),
            "abandoned_infra": [],
            "sold_vehicles": ["owned fleet resale"],
            "added": added,
            **eco_sell,
            "layout": _dump(keep["after_wh"], keep["after_asg"], after_m),
        })

    ranked = sorted(options, key=lambda o: float(o["npv"]), reverse=True)
    winner = ranked[0]
    horizon = int(policy["horizon_months"])
    rationale = (
        f"{winner['plan']} wins on {horizon}-month NPV (Rs.{winner['npv']:,.0f}): "
        f"delivery saved Rs.{winner['delivery_saved']:,.0f} "
        f"(fuel saved Rs.{winner['fuel_saved']:,.0f} inside it), "
        f"revenue enabled Rs.{winner['revenue']:,.0f}, "
        f"new-infra capex Rs.{winner['infra']:,.0f}, "
        f"frictions Rs.{winner['friction']:,.0f}, proceeds Rs.{winner['proceeds']:,.0f}. "
        f"Abandon options {'were' if policy['allow_abandon_infra'] else 'were NOT'} considered; "
        f"sell options {'were' if policy['allow_sell_vehicles'] else 'were NOT'} considered."
    )
    return {
        "recommended_plan": {
            "new_warehouses": winner["new_warehouses"],
            "added_vehicles": [],
            "abandoned_infra": winner["abandoned_infra"],
            "sold_vehicles": winner["sold_vehicles"],
        },
        "ranked_options": [
            {k: o[k] for k in ("plan", "npv", "infra", "fuel", "fuel_saved",
                               "delivery_saved", "revenue", "friction",
                               "proceeds", "new_warehouses",
                               "abandoned_infra", "sold_vehicles")}
            for o in ranked
        ],
        "layouts": {o["plan"]: o["layout"] for o in ranked},
        "rationale": rationale,
        "policy": policy,
    }


def expand_network(
    neighborhoods: List[Dict[str, Any]],
    existing_warehouses: List[Dict[str, Any]],
    add_count: int,
    config: OptimizationConfig,
    policy: Optional[Dict[str, Any]] = None,
    owned_vehicles: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """
    Expand an existing network by `add_count` warehouses.

    Existing warehouses keep their ids and coordinates; new ones are appended
    as W{K+1}... Serving assignments are recomputed (nearest site wins).
    Returns {"result", "new_warehouse_ids", "relief", "added"} where result is
    an OptimizationResult whose comparison pits BEFORE (existing layout) vs
    AFTER (expanded layout), plus a Phase-E "recommendation" with policy-gated
    keep/abandon/sell candidates ranked by horizon NPV.

    `existing_warehouses` accepts the Phase-A shape
    {warehouse_id, latitude, longitude, capacity?, radius_km?, infra_cost?} —
    callers without Phase A pass plain {warehouse_id, latitude, longitude}.
    `owned_vehicles` is accepted (mock fleet rows) for forward-compat and
    counted in the rationale; resale economics flow via policy.resale_value.
    """
    if not neighborhoods:
        raise ValueError("Cannot expand an empty neighborhood dataset.")
    if not existing_warehouses:
        raise ValueError("Expansion needs at least one existing warehouse.")
    if add_count is None or int(add_count) < 1:
        raise ValueError("add_count must be >= 1.")

    N = len(neighborhoods)
    K0 = len(existing_warehouses)
    K_total = min(K0 + int(add_count), MAX_WAREHOUSES, N)
    added = K_total - K0
    if added <= 0:
        raise ValueError(
            f"Nothing to add: network already at K={K0} "
            f"(max {MAX_WAREHOUSES}, nodes {N})."
        )

    coords = np.array(
        [[float(n["latitude"]), float(n["longitude"])] for n in neighborhoods]
    )
    weights = np.array([float(n["daily_orders"]) for n in neighborhoods])
    metric = _siting_metric(config)
    r_max = config.R_max_km if config.radius_enabled else None
    norm_policy = normalize_policy(policy)

    sites = np.array(
        [[float(w["latitude"]), float(w["longitude"])] for w in existing_warehouses]
    )

    # Greedy siting: each new warehouse relieves the currently worst-off site.
    for _ in range(added):
        dist = compute_distance_matrix(coords, sites, metric=metric)
        labels = _nearest_labels(dist)
        donor = _pick_donor_site(labels, weights, dist, r_max)
        subset = _relief_subset(donor, labels, weights, dist)
        new_site = weiszfeld_geometric_median(coords[subset], weights[subset])
        # Avoid stacking a new site on top of an existing one: fall back to
        # the single worst-served node of the donor instead.
        if len(sites) > 0:
            gap = compute_distance_matrix(
                np.atleast_2d(new_site), sites, metric="haversine"
            ).min()
            if gap < 0.5:
                worst = subset[int(np.argmax(dist[subset, donor]))]
                new_site = coords[worst].copy()
        sites = np.vstack([sites, np.atleast_2d(new_site)])

    # One shared fuel resolution so before/after economics match exactly.
    fuel_prices, fuel_live, fuel_note = resolve_fuel_prices(config)

    # Reported assignments must use the same metric as evaluation: under the
    # road metric, labels come from road distances (not the haversine siting
    # heuristic above) so distances, radius flags and costs stay consistent.
    true_metric = (config.distance_metric or "haversine").lower().strip()
    live_traffic = bool(getattr(config, "use_live_traffic", False))
    if true_metric == "road":
        labels_before = nearest_labels_for_metric(
            coords, sites[:K0], "road", live_traffic=live_traffic)
    else:
        dist_before = compute_distance_matrix(coords, sites[:K0], metric=metric)
        labels_before = _nearest_labels(dist_before)
    before_wh, before_asg, before_metrics = evaluate_network_layout(
        neighborhoods, sites[:K0], labels_before, config,
        fuel_prices=fuel_prices, fuel_live=fuel_live,
    )
    if true_metric == "road":
        labels_after = nearest_labels_for_metric(
            coords, sites, "road", live_traffic=live_traffic)
    else:
        dist_after = compute_distance_matrix(coords, sites, metric=metric)
        labels_after = _nearest_labels(dist_after)
    after_wh, after_asg, after_metrics = evaluate_network_layout(
        neighborhoods, sites, labels_after, config,
        fuel_prices=fuel_prices, fuel_live=fuel_live,
    )

    before_eval = LayoutEvaluation(
        metrics=before_metrics, warehouses=before_wh, assignments=before_asg
    )
    after_eval = LayoutEvaluation(
        metrics=after_metrics, warehouses=after_wh, assignments=after_asg
    )
    comparison = compute_comparison(before_eval, after_eval)

    before_load = {w.warehouse_id: int(w.assigned_orders or 0) for w in before_wh}
    relief = []
    for w in after_wh[:K0]:
        b = before_load.get(w.warehouse_id, 0)
        a = int(w.assigned_orders or 0)
        relief.append({
            "warehouse_id": w.warehouse_id,
            "before_orders": b,
            "after_orders": a,
            "orders_reduced": b - a,
            "pct_reduced": round((b - a) / max(1, b) * 100.0, 1),
        })

    expanded_config = config.model_copy(update={"K": K_total})
    infeasible = sum(1 for a in after_asg if not a.is_feasible)
    result = OptimizationResult(
        config=expanded_config,
        warehouses=after_wh,
        assignments=after_asg,
        metrics=after_metrics,
        comparison=comparison,
        is_feasible=infeasible == 0,
        infeasibility_reason=(
            None if infeasible == 0
            else f"{infeasible} assignments exceed radius limit after expansion"
        ),
        fuel_note=fuel_note,
        traffic_note=None,
        routing_note=None,
    )
    recommendation = build_recommendation(
        neighborhoods, existing_warehouses,
        {"before_metrics": before_metrics, "after_metrics": after_metrics,
         "added": added, "new_ids": [w.warehouse_id for w in after_wh[K0:]],
         "relief": relief, "after_wh": after_wh, "after_asg": after_asg,
         "sites_after": sites},
        config, norm_policy, fuel_prices, fuel_live,
    )
    if owned_vehicles:
        recommendation["rationale"] += (
            f" {len(owned_vehicles)} owned vehicle row(s) carried as the keep/sell fleet basis."
        )
    return {
        "result": result,
        "new_warehouse_ids": [w.warehouse_id for w in after_wh[K0:]],
        "relief": relief,
        "added": added,
        "policy": norm_policy,
        "recommendation": recommendation,
    }


def expansion_summary(payload: Dict[str, Any]) -> Tuple[List[str], List[Dict[str, Any]]]:
    """Convenience accessor for (new_ids, relief) in an expand_network return."""
    return payload.get("new_warehouse_ids", []), payload.get("relief", [])
