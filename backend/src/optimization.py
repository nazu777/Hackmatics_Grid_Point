"""
GridPoint Optimization Engine & Assignment Logic
Implements Weiszfeld Algorithm (K=1), Weighted K-Means (K>1), and PuLP MILP CFLP (schema.md §2, PRD §5.4).
"""
import math
from typing import List, Dict, Any, Tuple, Optional
import numpy as np
from sklearn.cluster import KMeans
import pulp

from .schema import (
    Neighborhood,
    Warehouse,
    Assignment,
    OptimizationConfig,
    OptimizationResult,
    Metrics,
    WarehouseMetric,
    LayoutEvaluation,
    ComparisonResult,
    ComparisonDelta
)
from .distance import compute_distance_matrix
from .cost import assignment_cost, assignment_fuel_cost, compute_comparison, resolve_fuel_prices


def weiszfeld_geometric_median(
    coords: np.ndarray,
    weights: np.ndarray,
    max_iter: int = 150,
    tol: float = 1e-6
) -> np.ndarray:
    """
    Computes the weighted geometric median (Fermat-Weber point) using the Weiszfeld algorithm.
    Minimizes: sum_i w_i * ||y - x_i||
    coords: (N, 2) array of coordinates.
    weights: (N,) array of weights (daily orders).
    Returns: (2,) array of [latitude, longitude].
    """
    if len(coords) == 0:
        return np.array([0.0, 0.0])
    if len(coords) == 1:
        return coords[0].copy()

    w_sum = np.sum(weights)
    if w_sum <= 0:
        weights = np.ones(len(coords))
        w_sum = len(coords)

    # Initial estimate: weighted center of mass
    y = np.sum(coords * weights[:, np.newaxis], axis=0) / w_sum

    eps = 1e-7  # Avoid division by zero at data points

    for _ in range(max_iter):
        diff = coords - y  # (N, 2)
        dist = np.linalg.norm(diff, axis=1)  # (N,)

        # Check if point coincides with one of the target points
        zero_dist_mask = dist < eps
        if np.any(zero_dist_mask):
            dist = np.maximum(dist, eps)

        inv_dist = weights / dist
        denom = np.sum(inv_dist)
        if denom == 0:
            break

        y_new = np.sum(coords * inv_dist[:, np.newaxis], axis=0) / denom

        if np.linalg.norm(y_new - y) < tol:
            y = y_new
            break
        y = y_new

    return y


def weighted_kmeans_optimization(
    coords: np.ndarray,
    weights: np.ndarray,
    K: int,
    random_seed: int = 42,
    refine_with_weiszfeld: bool = True
) -> Tuple[np.ndarray, np.ndarray]:
    """
    Solves unconstrained warehouse location using Weighted K-Means with k-means++ initialization.
    Optionally refines each cluster centroid using Weiszfeld geometric median (Continuous Weber Problem).
    Returns: (centers: (K, 2), labels: (N,))
    """
    K = min(K, len(coords))
    if K <= 1:
        center = weiszfeld_geometric_median(coords, weights)
        centers = np.atleast_2d(center)
        labels = np.zeros(len(coords), dtype=int)
        return centers, labels

    # Weighted KMeans via sklearn
    kmeans = KMeans(
        n_clusters=K,
        init="k-means++",
        n_init=10,
        max_iter=100,
        random_state=random_seed
    )
    kmeans.fit(coords, sample_weight=weights)
    labels = kmeans.labels_
    centers = kmeans.cluster_centers_.copy()

    # Refine each cluster center to the exact weighted geometric median
    if refine_with_weiszfeld:
        for k in range(K):
            cluster_mask = labels == k
            if np.any(cluster_mask):
                cluster_coords = coords[cluster_mask]
                cluster_weights = weights[cluster_mask]
                refined = weiszfeld_geometric_median(cluster_coords, cluster_weights)
                centers[k] = refined

    return centers, labels


def solve_cflp_milp(
    coords: np.ndarray,
    weights: np.ndarray,
    K: int,
    candidate_centers: np.ndarray,
    C_max: Optional[int],
    R_max_km: Optional[float],
    infra_cost: float,
    metric: str = "haversine"
) -> Tuple[bool, Optional[np.ndarray], Optional[np.ndarray], Optional[str]]:
    """
    Solves the Capacitated Facility Location Problem (CFLP) using Mixed-Integer Linear Programming (PuLP).
    Returns: (feasible: bool, chosen_warehouses: (K, 2), labels: (N,), reason_if_infeasible: str)
    """
    N = len(coords)
    M = len(candidate_centers)

    # Compute pairwise distance matrix between demand points and candidate facilities
    dist_matrix = compute_distance_matrix(coords, candidate_centers, metric=metric)

    # Pre-feasibility checks
    total_demand = int(np.sum(weights))
    if C_max is not None and (K * C_max < total_demand):
        return (
            False,
            None,
            None,
            f"Total network capacity ({K * C_max}) is less than total demand ({total_demand})."
        )

    # Build MILP problem
    prob = pulp.LpProblem("GridPoint_CFLP", pulp.LpMinimize)

    # Decision variables
    # y[k] = 1 if facility k is open, 0 otherwise
    y = [pulp.LpVariable(f"y_{k}", cat=pulp.LpBinary) for k in range(M)]

    # x[i, k] = 1 if neighborhood i is served by facility k
    x = [
        [pulp.LpVariable(f"x_{i}_{k}", cat=pulp.LpBinary) for k in range(M)]
        for i in range(N)
    ]

    # Objective: Minimize weighted delivery distance + infrastructure costs
    objective_terms = []
    for i in range(N):
        w_i = float(weights[i])
        for k in range(M):
            d_ik = float(dist_matrix[i, k])
            objective_terms.append(w_i * d_ik * x[i][k])

    if infra_cost > 0:
        for k in range(M):
            objective_terms.append(infra_cost * y[k])

    prob += pulp.lpSum(objective_terms), "Total_Weighted_Cost"

    # Constraint 1: Single assignment - each neighborhood must be assigned to exactly 1 facility
    for i in range(N):
        prob += pulp.lpSum(x[i][k] for k in range(M)) == 1, f"Assign_One_Facility_{i}"

    # Constraint 2: Exactly K facilities open
    prob += pulp.lpSum(y[k] for k in range(M)) == K, "Open_K_Facilities"

    # Constraint 3 & 4: Capacity limit & Facility activation
    for k in range(M):
        # Capacity limit
        if C_max is not None:
            prob += (
                pulp.lpSum(float(weights[i]) * x[i][k] for i in range(N)) <= C_max * y[k],
                f"Capacity_Limit_{k}"
            )
        else:
            # Enforce x[i,k] <= y[k]
            for i in range(N):
                prob += x[i][k] <= y[k], f"Activation_{i}_{k}"

    # Constraint 5: Maximum service radius limit
    if R_max_km is not None and R_max_km > 0:
        for i in range(N):
            for k in range(M):
                if dist_matrix[i, k] > R_max_km:
                    prob += x[i][k] == 0, f"Radius_Exceeded_{i}_{k}"

    # Solve with CBC
    solver = pulp.PULP_CBC_CMD(msg=False, timeLimit=10)
    status = prob.solve(solver)

    if status != pulp.LpStatusOptimal:
        return (
            False,
            None,
            None,
            f"MILP solver found no feasible solution (Status: {pulp.LpStatus[status]}). "
            f"Consider relaxing service radius or increasing warehouse count/capacity."
        )

    # Extract chosen facilities and assignments
    open_indices = [k for k in range(M) if pulp.value(y[k]) and pulp.value(y[k]) > 0.5]
    # If solver opened fewer or more due to numerical reasons, take top K
    if len(open_indices) != K:
        open_indices = sorted(range(M), key=lambda k: pulp.value(y[k]) or 0, reverse=True)[:K]

    chosen_centers = candidate_centers[open_indices]
    chosen_index_map = {orig_k: new_idx for new_idx, orig_k in enumerate(open_indices)}

    labels = np.zeros(N, dtype=int)
    for i in range(N):
        assigned_k = None
        for k in open_indices:
            val = pulp.value(x[i][k])
            if val is not None and val > 0.5:
                assigned_k = chosen_index_map[k]
                break
        if assigned_k is None:
            # Fallback to nearest open center
            dists_to_open = [dist_matrix[i, orig_k] for orig_k in open_indices]
            assigned_k = int(np.argmin(dists_to_open))
        labels[i] = assigned_k

    return True, chosen_centers, labels, None


def evaluate_network_layout(
    neighborhoods: List[Dict[str, Any]],
    warehouse_coords: np.ndarray,
    labels: np.ndarray,
    config: OptimizationConfig,
    fuel_prices: Optional[Dict[str, float]] = None,
    fuel_live: bool = False,
) -> Tuple[List[Warehouse], List[Assignment], Metrics]:
    """
    Computes all distances, costs, and warehouse utilization metrics for a given layout (schema.md §2.5, §2.6).
    fuel_prices/fuel_live are resolved once per run in run_optimization so both
    layouts share identical fuel economics (cached, single lookup).
    """
    N = len(neighborhoods)
    K = len(warehouse_coords)

    coords = np.array([[float(n["latitude"]), float(n["longitude"])] for n in neighborhoods])
    dist_matrix = compute_distance_matrix(coords, warehouse_coords, metric=config.distance_metric)

    warehouses: List[Warehouse] = []
    assignments: List[Assignment] = []

    # Initialize warehouse objects
    for k in range(K):
        wid = f"W{k+1}"
        warehouses.append(Warehouse(
            warehouse_id=wid,
            latitude=round(float(warehouse_coords[k, 0]), 6),
            longitude=round(float(warehouse_coords[k, 1]), 6),
            capacity=config.C_max if config.capacity_enabled else None,
            radius_km=config.R_max_km if config.radius_enabled else None,
            infra_cost=config.infra_cost_per_warehouse
        ))

    total_unweighted_dist = 0.0
    total_weighted_dist = 0.0
    total_cost = 0.0
    total_fuel_cost = 0.0
    infeasible_count = 0

    warehouse_orders = [0 for _ in range(K)]
    warehouse_distances = [[] for _ in range(K)]
    warehouse_nodes_count = [0 for _ in range(K)]

    for i in range(N):
        node = neighborhoods[i]
        nid = str(node["neighborhood_id"])
        w_i = int(node["daily_orders"])
        assigned_k = int(labels[i])
        wid = warehouses[assigned_k].warehouse_id

        d_km = float(dist_matrix[i, assigned_k])
        weighted_d = w_i * d_km
        cost_i = assignment_cost(w_i, d_km, config, fuel_prices)

        within_rad = True
        if config.radius_enabled and config.R_max_km is not None:
            within_rad = d_km <= config.R_max_km

        is_feas = within_rad
        if not is_feas:
            infeasible_count += 1

        assignments.append(Assignment(
            neighborhood_id=nid,
            warehouse_id=wid,
            distance_km=round(d_km, 2),
            weighted_distance=round(weighted_d, 2),
            cost=round(cost_i, 2),
            within_radius=within_rad,
            is_feasible=is_feas
        ))

        total_unweighted_dist += d_km
        total_weighted_dist += weighted_d
        total_cost += cost_i
        total_fuel_cost += assignment_fuel_cost(w_i, d_km, config, fuel_prices)

        warehouse_orders[assigned_k] += w_i
        warehouse_distances[assigned_k].append(d_km)
        warehouse_nodes_count[assigned_k] += 1

    # Add fixed infrastructure costs
    total_infra_cost = sum(config.infra_cost_per_warehouse for _ in range(K))
    total_cost += total_infra_cost

    # Build warehouse summary metrics
    warehouse_metrics: List[WarehouseMetric] = []
    for k in range(K):
        assigned_ord = warehouse_orders[k]
        warehouses[k].assigned_orders = assigned_ord
        util_pct = None
        if config.capacity_enabled and config.C_max is not None and config.C_max > 0:
            util_pct = round((assigned_ord / config.C_max) * 100.0, 1)
            warehouses[k].utilization_pct = util_pct

        avg_d = 0.0
        if warehouse_distances[k]:
            avg_d = round(sum(warehouse_distances[k]) / len(warehouse_distances[k]), 2)

        warehouse_metrics.append(WarehouseMetric(
            warehouse_id=warehouses[k].warehouse_id,
            assigned_orders=assigned_ord,
            utilization_pct=util_pct,
            avg_distance_km=avg_d,
            neighborhood_count=warehouse_nodes_count[k]
        ))

    total_demand = sum(int(n["daily_orders"]) for n in neighborhoods)
    avg_dist_per_order = total_weighted_dist / max(1, total_demand)
    avg_weighted_dist = total_weighted_dist / max(1, N)

    feasibility_ratio = round((N - infeasible_count) / max(1, N), 4)

    metrics = Metrics(
        total_unweighted_distance_km=round(total_unweighted_dist, 2),
        total_weighted_distance_km_orders=round(total_weighted_dist, 2),
        total_cost=round(total_cost, 2),
        total_fuel_cost=round(total_fuel_cost, 2),
        fuel_live=fuel_live,
        avg_distance_per_order_km=round(avg_dist_per_order, 2),
        avg_weighted_distance_km=round(avg_weighted_dist, 2),
        warehouses=warehouse_metrics,
        infeasible_assignments=infeasible_count,
        feasibility_ratio=feasibility_ratio
    )

    return warehouses, assignments, metrics


def compute_baseline_layout(
    neighborhoods: List[Dict[str, Any]],
    config: OptimizationConfig,
    fuel_prices: Optional[Dict[str, float]] = None,
    fuel_live: bool = False,
) -> LayoutEvaluation:
    """
    Computes baseline / original layout according to config.baseline_mode (schema.md §2.4, PRD §5.7).
    """
    coords = np.array([[float(n["latitude"]), float(n["longitude"])] for n in neighborhoods])
    weights = np.array([float(n["daily_orders"]) for n in neighborhoods])

    if config.baseline_mode == "mean":
        base_center = np.mean(coords, axis=0)
        base_centers = np.atleast_2d(base_center)
    elif config.baseline_mode == "single_center":
        base_center = weiszfeld_geometric_median(coords, weights)
        base_centers = np.atleast_2d(base_center)
    elif config.baseline_mode == "custom" and config.custom_baseline_warehouses:
        base_centers = np.array([[w.latitude, w.longitude] for w in config.custom_baseline_warehouses])
    else:  # default: 'centroid' (bounding box center)
        min_lat, min_lon = np.min(coords, axis=0)
        max_lat, max_lon = np.max(coords, axis=0)
        base_center = np.array([(min_lat + max_lat) / 2.0, (min_lon + max_lon) / 2.0])
        base_centers = np.atleast_2d(base_center)

    # Assign all nodes to nearest baseline warehouse
    dist_matrix = compute_distance_matrix(coords, base_centers, metric=config.distance_metric)
    labels = np.argmin(dist_matrix, axis=1)

    warehouses, assignments, metrics = evaluate_network_layout(
        neighborhoods,
        base_centers,
        labels,
        config,
        fuel_prices=fuel_prices,
        fuel_live=fuel_live,
    )

    return LayoutEvaluation(
        metrics=metrics,
        warehouses=warehouses,
        assignments=assignments
    )


def run_optimization(
    neighborhoods: List[Dict[str, Any]],
    config: OptimizationConfig
) -> OptimizationResult:
    """
    Main Phase 3 Optimization Engine entry point.
    Executes Weiszfeld (K=1), Weighted K-Means (K>1), or PuLP MILP (Constrained CFLP).
    Computes comparative evaluation against baseline arrangement.
    """
    if not neighborhoods:
        raise ValueError("Cannot optimize empty neighborhood dataset.")

    N = len(neighborhoods)
    K = min(config.K, N)

    coords = np.array([[float(n["latitude"]), float(n["longitude"])] for n in neighborhoods])
    weights = np.array([float(n["daily_orders"]) for n in neighborhoods])

    is_feasible = True
    infeasibility_reason = None

    # Resolve live fuel prices once per run (TTL-cached) so baseline and
    # optimized layouts share identical fuel economics.
    fuel_prices, fuel_live, fuel_note = resolve_fuel_prices(config)

    # Determine optimization approach: Unconstrained vs Constrained MILP
    use_milp = (config.capacity_enabled or config.radius_enabled) and N <= 500

    if use_milp:
        # Generate candidate facility locations:
        # Combine weighted k-means centers + cluster medoids + top demand locations
        initial_centers, _ = weighted_kmeans_optimization(
            coords, weights, K=K, random_seed=config.random_seed
        )
        # Select top demand nodes as additional candidate sites
        top_k_indices = np.argsort(weights)[-min(K * 2, N):]
        candidate_pool = np.unique(
            np.vstack([initial_centers, coords[top_k_indices]]),
            axis=0
        )

        milp_feas, chosen_centers, labels, reason = solve_cflp_milp(
            coords=coords,
            weights=weights,
            K=K,
            candidate_centers=candidate_pool,
            C_max=config.C_max if config.capacity_enabled else None,
            R_max_km=config.R_max_km if config.radius_enabled else None,
            infra_cost=config.infra_cost_per_warehouse,
            metric=config.distance_metric
        )

        if milp_feas and chosen_centers is not None and labels is not None:
            opt_centers = chosen_centers
            opt_labels = labels
        else:
            # Fallback to unconstrained weighted K-Means with warning
            is_feasible = False
            infeasibility_reason = reason or "MILP constraints infeasible. Falling back to nearest unconstrained layout."
            opt_centers, opt_labels = weighted_kmeans_optimization(
                coords, weights, K=K, random_seed=config.random_seed
            )

    else:
        # Unconstrained optimization (Weiszfeld for K=1, Weighted K-Means for K>1)
        opt_centers, opt_labels = weighted_kmeans_optimization(
            coords, weights, K=K, random_seed=config.random_seed
        )

    # Evaluate optimized layout
    warehouses, assignments, metrics = evaluate_network_layout(
        neighborhoods,
        opt_centers,
        opt_labels,
        config,
        fuel_prices=fuel_prices,
        fuel_live=fuel_live,
    )

    # Compute baseline comparison (Phase 4 cost engine)
    baseline_eval = compute_baseline_layout(neighborhoods, config,
                                            fuel_prices=fuel_prices, fuel_live=fuel_live)
    opt_eval = LayoutEvaluation(metrics=metrics, warehouses=warehouses, assignments=assignments)
    comparison = compute_comparison(baseline_eval, opt_eval)

    return OptimizationResult(
        config=config,
        warehouses=warehouses,
        assignments=assignments,
        metrics=metrics,
        comparison=comparison,
        is_feasible=is_feasible,
        infeasibility_reason=infeasibility_reason,
        fuel_note=fuel_note,
    )
