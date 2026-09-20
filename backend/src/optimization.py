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


def nearest_labels_for_metric(
    coords: np.ndarray,
    centers: np.ndarray,
    metric: str,
    live_traffic: bool = False,
    notes: Optional[List[str]] = None,
) -> np.ndarray:
    """
    Nearest-center assignment honoring the configured distance metric.
    When metric == "road", labels come from the road routing provider
    (TomTom live / OSRM / straight-line fallback) so the assignment matches
    the road distances reported by evaluate_network_layout. The plain
    compute_distance_matrix dispatcher has no "road" branch and would
    silently assign by straight-line distance instead.
    """
    if (metric or "haversine").lower().strip() == "road":
        from .routing import road_matrices
        dist, _, note = road_matrices(coords, centers, live_traffic=live_traffic)
        if notes is not None and note not in notes:
            notes.append(note)
        return np.argmin(dist, axis=1)
    return np.argmin(
        compute_distance_matrix(coords, centers, metric=metric), axis=1)


def resolve_live_traffic(config: OptimizationConfig) -> bool:
    """
    Phase C (#5-opt): effective live-traffic switch.

    `use_live_traffic` (corridor speeds) OR `use_live_traffic_for_routing`
    (explicit "optimize on current traffic" toggle) enables live reads in
    matrices, assignment, and corridor resolution. Offline/keyless runs
    degrade to history + manual floor with live=false provenance.
    """
    return bool(getattr(config, "use_live_traffic", False)
                or getattr(config, "use_live_traffic_for_routing", False))


def fleet_avg_speed_kmph(config: OptimizationConfig, default: float = 35.0) -> float:
    """Capacity-weighted fleet speed, or default when no fleet is configured."""
    try:
        fleet = list(getattr(config, "vehicle_fleet", None) or [])
    except TypeError:
        return default
    if not fleet:
        return default
    total = 0
    weighted = 0.0
    for v in fleet:
        try:
            cap = max(1, int(getattr(v, "capacity", 1) or 1))
            spd = float(getattr(v, "avg_speed_kmph", 0) or 0)
        except (TypeError, ValueError):
            continue
        if spd <= 0:
            continue
        total += cap
        weighted += spd * cap
    return (weighted / total) if total > 0 else default


def estimate_time_min(d_km: float, congestion: float, speed_kmph: float) -> float:
    """Free-flow drive time inflated by corridor congestion."""
    return float(d_km) / max(5.0, float(speed_kmph)) * 60.0 * (1.0 + max(0.0, float(congestion or 0.0)))


def reroute_assignments(
    coords: np.ndarray,
    weights: np.ndarray,
    warehouse_coords: np.ndarray,
    current_labels: np.ndarray,
    config: OptimizationConfig,
    corridor: Optional[Dict[int, float]] = None,
    dist_matrix: Optional[np.ndarray] = None,
    dur_matrix: Optional[np.ndarray] = None,
    fuel_prices: Optional[Dict[str, float]] = None,
    alpha: float = 1.0,
    beta_per_min: float = 0.5,
) -> Tuple[np.ndarray, Dict[str, Any]]:
    """
    Phase C (#9): dynamic reroute — re-evaluate assignment as corridor
    conditions change, minimizing score = alpha * cost + beta * time.

    Cost is the full delivery cost (w_i * d_eff * rate_eff, congestion-aware);
    time is provider duration when a road duration matrix is available, else
    estimated from distance/speed inflated by the same corridor congestion.
    Capacity/radius constraints are NOT re-solved here (assignment-only
    refinement); infeasible picks fall back to the nearest feasible center.

    Returns (new_labels, summary {changed, moved_ids, saved_cost, saved_minutes}).
    """
    from .cost import assignment_cost

    N = len(coords)
    K = len(warehouse_coords)
    if N == 0 or K == 0:
        return np.array(current_labels, dtype=int), {
            "changed": 0, "moved_ids": [], "saved_cost": 0.0, "saved_minutes": 0.0,
        }
    if dist_matrix is None:
        if (config.distance_metric or "haversine").lower().strip() == "road":
            from .routing import road_matrices
            dist_matrix, dur_matrix, _ = road_matrices(
                coords, warehouse_coords, live_traffic=resolve_live_traffic(config))
        else:
            dist_matrix = compute_distance_matrix(coords, warehouse_coords, metric=config.distance_metric)
    else:
        dist_matrix = np.asarray(dist_matrix, dtype=float)
    if dur_matrix is not None:
        dur_matrix = np.asarray(dur_matrix, dtype=float)

    speed = fleet_avg_speed_kmph(config)
    corridor = corridor or {}
    old_cost = 0.0
    old_time = 0.0
    new_labels = np.zeros(N, dtype=int)
    for i in range(N):
        w_i = float(weights[i]) if i < len(weights) else 0.0
        best_k = int(current_labels[i]) if i < len(current_labels) else 0
        best_k = max(0, min(K - 1, best_k))
        best_score = None
        for k in range(K):
            d = float(dist_matrix[i, k])
            cong = float(corridor.get(k, 0.0) or 0.0)
            cost_ik = assignment_cost(int(round(w_i)), d, config, fuel_prices, cong)
            if dur_matrix is not None:
                try:
                    t_ik = float(dur_matrix[i, k]) * (1.0 + max(0.0, cong)) \
                        if float(dur_matrix[i, k]) > 0 else estimate_time_min(d, cong, speed)
                except (IndexError, TypeError, ValueError):
                    t_ik = estimate_time_min(d, cong, speed)
            else:
                t_ik = estimate_time_min(d, cong, speed)
            score = float(alpha) * cost_ik + float(beta_per_min) * t_ik
            if best_score is None or score < best_score:
                best_score = score
                best_k = k
        new_labels[i] = best_k
        # Accumulate old vs new totals for the savings report.
        ck_old = max(0, min(K - 1, int(current_labels[i]) if i < len(current_labels) else 0))
        ck_new = int(new_labels[i])
        for ck, acc in ((ck_old, "old"), (ck_new, "new")):
            d = float(dist_matrix[i, ck])
            cong = float(corridor.get(ck, 0.0) or 0.0)
            c = assignment_cost(int(round(w_i)), d, config, fuel_prices, cong)
            t = (float(dur_matrix[i, ck]) * (1.0 + max(0.0, cong))
                 if dur_matrix is not None else estimate_time_min(d, cong, speed))
            if acc == "old":
                old_cost += c
                old_time += t
            else:
                pass
        # (new totals accumulated below in a second pass for clarity)
    new_cost = 0.0
    new_time = 0.0
    for i in range(N):
        w_i = float(weights[i]) if i < len(weights) else 0.0
        ck = int(new_labels[i])
        d = float(dist_matrix[i, ck])
        cong = float(corridor.get(ck, 0.0) or 0.0)
        new_cost += assignment_cost(int(round(w_i)), d, config, fuel_prices, cong)
        new_time += (float(dur_matrix[i, ck]) * (1.0 + max(0.0, cong))
                     if dur_matrix is not None else estimate_time_min(d, cong, speed))
    changed_idx = [i for i in range(N) if int(new_labels[i]) != int(current_labels[i])]
    return new_labels, {
        "changed": len(changed_idx),
        "moved_idx": changed_idx,
        "saved_cost": round(old_cost - new_cost, 2),
        "saved_minutes": round(old_time - new_time, 1),
        "old_cost": round(old_cost, 2),
        "new_cost": round(new_cost, 2),
        "old_minutes": round(old_time, 1),
        "new_minutes": round(new_time, 1),
    }


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
    metric: str = "haversine",
    col_multipliers: Optional[np.ndarray] = None,
    dist_matrix: Optional[np.ndarray] = None,
) -> Tuple[bool, Optional[np.ndarray], Optional[np.ndarray], Optional[str]]:
    """
    Solves the Capacitated Facility Location Problem (CFLP) using Mixed-Integer Linear Programming (PuLP).
    col_multipliers optionally scales each candidate column (e.g. 1 + historical
    congestion) so placement prefers historically fluid corridors.
    Returns: (feasible: bool, chosen_warehouses: (K, 2), labels: (N,), reason_if_infeasible: str)
    """
    N = len(coords)
    M = len(candidate_centers)

    # Compute pairwise distance matrix between demand points and candidate facilities
    # (callers may inject a precomputed road matrix instead)
    if dist_matrix is None:
        dist_matrix = compute_distance_matrix(coords, candidate_centers, metric=metric)
    if col_multipliers is not None:
        mult = np.asarray(col_multipliers, dtype=float).reshape(1, M)
        dist_matrix = dist_matrix * np.maximum(1.0, mult)

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
    corridor: Optional[Dict[int, float]] = None,
    notes: Optional[List[str]] = None,
) -> Tuple[List[Warehouse], List[Assignment], Metrics]:
    """
    Computes all distances, costs, and warehouse utilization metrics for a given layout (schema.md §2.5, §2.6).
    fuel_prices/fuel_live are resolved once per run in run_optimization so both
    layouts share identical fuel economics (cached, single lookup).
    corridor maps warehouse index -> congestion delay ratio applied to its
    assignments (live + history, resolved once per run).
    When config.distance_metric == "road", distances (and travel times) come
    from the road routing provider; provider notes are appended to `notes`.
    """
    N = len(neighborhoods)
    K = len(warehouse_coords)

    coords = np.array([[float(n["latitude"]), float(n["longitude"])] for n in neighborhoods])
    dur_matrix = None
    if config.distance_metric == "road":
        from .routing import road_matrices
        dist_matrix, dur_matrix, road_note = road_matrices(
            coords, warehouse_coords, live_traffic=resolve_live_traffic(config))
        if notes is not None and road_note not in notes:
            notes.append(road_note)
    else:
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
        cong = float(corridor.get(assigned_k, 0.0)) if corridor else 0.0
        cost_i = assignment_cost(w_i, d_km, config, fuel_prices, cong)

        within_rad = True
        if config.radius_enabled and config.R_max_km is not None:
            within_rad = d_km <= config.R_max_km

        is_feas = within_rad
        if not is_feas:
            infeasible_count += 1

        t_min = None
        if dur_matrix is not None:
            t_min = round(float(dur_matrix[i, assigned_k]), 1)
        fuel_i = assignment_fuel_cost(w_i, d_km, config, fuel_prices, cong)
        assignments.append(Assignment(
            neighborhood_id=nid,
            warehouse_id=wid,
            distance_km=round(d_km, 2),
            weighted_distance=round(weighted_d, 2),
            cost=round(cost_i, 2),
            fuel_cost=round(fuel_i, 2),
            within_radius=within_rad,
            is_feasible=is_feas,
            congestion_pct=round(cong, 4),
            travel_time_min=t_min,
        ))

        total_unweighted_dist += d_km
        total_weighted_dist += weighted_d
        total_cost += cost_i
        total_fuel_cost += assignment_fuel_cost(w_i, d_km, config, fuel_prices, cong)

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

    congs = [float(a.congestion_pct) for a in assignments if a.congestion_pct is not None]
    metrics = Metrics(
        total_unweighted_distance_km=round(total_unweighted_dist, 2),
        total_weighted_distance_km_orders=round(total_weighted_dist, 2),
        total_cost=round(total_cost, 2),
        total_fuel_cost=round(total_fuel_cost, 2),
        fuel_live=fuel_live,
        avg_congestion_pct=round(sum(congs) / len(congs), 4) if congs else 0.0,
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
    apply_history: bool = False,
    notes: Optional[List[str]] = None,
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

    # Assign all nodes to nearest baseline warehouse (road-aware when
    # metric == "road" so labels match the evaluated road distances).
    labels = nearest_labels_for_metric(
        coords, base_centers, config.distance_metric,
        live_traffic=resolve_live_traffic(config), notes=notes)

    base_corridor: Optional[Dict[int, float]] = None
    if apply_history:
        from .traffic import historical_corridors
        hist_corr, _ = historical_corridors(
            base_centers, config.traffic_hour)
        base_corridor = {k: float(v) for k, v in enumerate(hist_corr)}
    warehouses, assignments, metrics = evaluate_network_layout(
        neighborhoods,
        base_centers,
        labels,
        config,
        fuel_prices=fuel_prices,
        fuel_live=fuel_live,
        corridor=base_corridor,
        notes=notes,
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
    # optimized layouts share identical fuel economics. The price city is
    # auto-derived from the dataset center — the user is never asked.
    data_center = (float(np.mean(coords[:, 0])), float(np.mean(coords[:, 1])))
    fuel_prices, fuel_live, fuel_note = resolve_fuel_prices(config, center=data_center)
    hour = config.traffic_hour
    manual_traffic = float(config.traffic_factor or 0.0)

    # Determine optimization approach: Unconstrained vs Constrained MILP
    use_milp = (config.capacity_enabled or config.radius_enabled) and N <= 500
    hist_samples = 0
    milp_notes: List[str] = []

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

        # Steer MILP placement with past corridor congestion (history only,
        # no network in the solver path): congested candidate sites cost more.
        from .traffic import historical_corridors
        hist_corr, hist_samples = historical_corridors(candidate_pool, hour)
        milp_dist = None
        if config.distance_metric == "road":
            from .routing import road_matrices
            milp_dist, _, milp_note = road_matrices(
                coords, candidate_pool, live_traffic=resolve_live_traffic(config))
            milp_notes.append(milp_note)
        milp_feas, chosen_centers, labels, reason = solve_cflp_milp(
            coords=coords,
            weights=weights,
            K=K,
            candidate_centers=candidate_pool,
            C_max=config.C_max if config.capacity_enabled else None,
            R_max_km=config.R_max_km if config.radius_enabled else None,
            infra_cost=config.infra_cost_per_warehouse,
            metric=config.distance_metric,
            col_multipliers=(1.0 + hist_corr + manual_traffic) if (hist_samples > 0 or manual_traffic > 0) else None,
            dist_matrix=milp_dist,
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
            if config.distance_metric == "road" and len(opt_centers) > 1:
                opt_labels = nearest_labels_for_metric(
                    coords, opt_centers, "road",
                    live_traffic=resolve_live_traffic(config), notes=milp_notes,
                )

    else:
        # Unconstrained optimization (Weiszfeld for K=1, Weighted K-Means for K>1).
        # K-Means labels are euclidean in degree space, so under the road
        # metric every node is reassigned to its road-nearest center before
        # evaluation (distances, radius feasibility, costs all stay consistent).
        opt_centers, opt_labels = weighted_kmeans_optimization(
            coords, weights, K=K, random_seed=config.random_seed
        )
        if config.distance_metric == "road" and len(opt_centers) > 1:
            opt_labels = nearest_labels_for_metric(
                coords, opt_centers, "road",
                live_traffic=resolve_live_traffic(config), notes=milp_notes,
            )

    # Resolve corridor congestion for the final warehouse sites.
    # Default: one cached TomTom point-read per site (K calls at most).
    # Phase C (#5-opt): with use_live_traffic_for_routing, corridors are
    # sampled along the assigned road segments (node + midpoint + warehouse
    # per corridor, bounded to the heaviest corridors) so live segment
    # speeds feed matrices + assignment; readings persist to history.
    from .traffic import corridor_factor
    effective_live = resolve_live_traffic(config)
    corridor: Dict[int, float] = {}
    live_corridors = 0
    corridor_samples = 0
    corridor_live_detail: Dict[int, bool] = {}
    if config.use_live_traffic_for_routing:
        from .traffic import corridor_traffic_from_assignments
        prov_wh = [{"warehouse_id": f"W{k+1}",
                    "latitude": float(opt_centers[k, 0]),
                    "longitude": float(opt_centers[k, 1])} for k in range(len(opt_centers))]
        order = sorted(range(N), key=lambda i: -float(weights[i]))
        cap_n = min(N, 60)
        prov_asg = [{"neighborhood_id": str(neighborhoods[i].get("neighborhood_id", f"N{i}")),
                     "warehouse_id": f"W{int(opt_labels[i])+1}"} for i in order[:cap_n]]
        try:
            agg = corridor_traffic_from_assignments(
                [neighborhoods[i] for i in order[:cap_n]], prov_wh, prov_asg,
                manual_floor=manual_traffic, hour=hour,
                allow_live=effective_live, samples_per_corridor=3)
            for k in range(len(opt_centers)):
                info = agg.get(f"W{k+1}")
                if info is not None:
                    corridor[k] = float(info["factor"])
                    corridor_live_detail[k] = bool(info["live"])
                    live_corridors += 1 if info["live"] else 0
                    corridor_samples += int(info["samples"])
                else:
                    cf = corridor_factor(float(opt_centers[k, 0]), float(opt_centers[k, 1]),
                                         manual_floor=manual_traffic, hour=hour,
                                         allow_live=effective_live)
                    corridor[k] = float(cf["factor"])
                    corridor_live_detail[k] = bool(cf["live"])
                    live_corridors += 1 if cf["live"] else 0
                    corridor_samples += int(cf["samples"])
        except Exception:
            corridor = {}
            live_corridors = 0
            corridor_samples = 0
    if not corridor:
        for k in range(len(opt_centers)):
            cf = corridor_factor(float(opt_centers[k, 0]), float(opt_centers[k, 1]),
                                 manual_floor=manual_traffic, hour=hour,
                                 allow_live=effective_live)
            corridor[k] = float(cf["factor"])
            corridor_live_detail[k] = bool(cf["live"])
            live_corridors += 1 if cf["live"] else 0
            corridor_samples += int(cf["samples"])

    # Evaluate optimized layout (road distances + travel times when metric=road)
    routing_notes: List[str] = list(milp_notes)
    warehouses, assignments, metrics = evaluate_network_layout(
        neighborhoods,
        opt_centers,
        opt_labels,
        config,
        fuel_prices=fuel_prices,
        fuel_live=fuel_live,
        corridor=corridor,
        notes=routing_notes,
    )

    # Phase C (#9): traffic-aware reroute refinement — re-evaluate assignment
    # as corridor conditions change, minimizing alpha * cost + beta * time.
    # Runs on fixed sites (no relocation); applied only when the toggle is on
    # and more than one warehouse exists.
    if config.traffic_aware_reroute and len(opt_centers) > 1:
        try:
            new_labels, reroute_summary = reroute_assignments(
                coords, weights, opt_centers, opt_labels, config,
                corridor=corridor, fuel_prices=fuel_prices,
                alpha=1.0, beta_per_min=0.5)
            if reroute_summary.get("changed", 0) > 0:
                opt_labels = new_labels
                warehouses, assignments, metrics = evaluate_network_layout(
                    neighborhoods, opt_centers, opt_labels, config,
                    fuel_prices=fuel_prices, fuel_live=fuel_live,
                    corridor=corridor, notes=routing_notes)
                routing_notes.append(
                    f"Traffic-aware reroute (1.0*cost + 0.5/min): "
                    f"{reroute_summary['changed']} nodes moved, "
                    f"saved Rs.{reroute_summary['saved_cost']:.2f} and "
                    f"{reroute_summary['saved_minutes']:.1f} min")
        except Exception:
            pass

    # Compute baseline comparison (Phase 4 cost engine, history-steered too)
    baseline_eval = compute_baseline_layout(neighborhoods, config,
                                            fuel_prices=fuel_prices, fuel_live=fuel_live,
                                            apply_history=True, notes=routing_notes)
    opt_eval = LayoutEvaluation(metrics=metrics, warehouses=warehouses, assignments=assignments)
    comparison = compute_comparison(baseline_eval, opt_eval)
    routing_note = "; ".join(routing_notes) if routing_notes else None

    if effective_live and live_corridors > 0:
        src = ("road-corridor segments" if config.use_live_traffic_for_routing
               else "warehouse sites")
        traffic_note = (f"Live TomTom corridors ({live_corridors}/{len(opt_centers)} {src}, "
                        f"avg +{metrics.avg_congestion_pct * 100:.0f}%) + {corridor_samples} history samples")
        if config.use_live_traffic_for_routing:
            traffic_note = "Optimize on current traffic: " + traffic_note
    elif corridor_samples > 0 or hist_samples > 0:
        traffic_note = (f"History-based congestion ({corridor_samples} samples this run); "
                        "enable live traffic for real-time speeds")
        if config.use_live_traffic_for_routing:
            traffic_note = "Optimize on current traffic (" + traffic_note[0].lower() + traffic_note[1:] + ")"
    elif manual_traffic > 0:
        traffic_note = f"Manual congestion floor +{manual_traffic * 100:.0f}% (no history yet)"
        if config.use_live_traffic_for_routing:
            traffic_note = "Optimize on current traffic: " + traffic_note[0].lower() + traffic_note[1:]
    elif config.use_live_traffic_for_routing:
        traffic_note = ("Optimize on current traffic requested but no live/history data yet "
                        "(free-flow; add a TOMTOM_KEY or record corridor history)")
    else:
        traffic_note = "Free-flow (no congestion data yet)"

    return OptimizationResult(
        config=config,
        warehouses=warehouses,
        assignments=assignments,
        metrics=metrics,
        comparison=comparison,
        is_feasible=is_feasible,
        infeasibility_reason=infeasibility_reason,
        fuel_note=fuel_note,
        traffic_note=traffic_note,
        routing_note=routing_note,
    )
