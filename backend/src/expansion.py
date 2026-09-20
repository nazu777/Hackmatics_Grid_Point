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


def expand_network(
    neighborhoods: List[Dict[str, Any]],
    existing_warehouses: List[Dict[str, Any]],
    add_count: int,
    config: OptimizationConfig,
) -> Dict[str, Any]:
    """
    Expand an existing network by `add_count` warehouses.

    Existing warehouses keep their ids and coordinates; new ones are appended
    as W{K+1}... Serving assignments are recomputed (nearest site wins).
    Returns {"result", "new_warehouse_ids", "relief", "added"} where result is
    an OptimizationResult whose comparison pits BEFORE (existing layout) vs
    AFTER (expanded layout).
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
    return {
        "result": result,
        "new_warehouse_ids": [w.warehouse_id for w in after_wh[K0:]],
        "relief": relief,
        "added": added,
    }


def expansion_summary(payload: Dict[str, Any]) -> Tuple[List[str], List[Dict[str, Any]]]:
    """Convenience accessor for (new_ids, relief) in an expand_network return."""
    return payload.get("new_warehouse_ids", []), payload.get("relief", [])
