"""
GridPoint FastAPI Backend
Provides REST endpoints for data ingestion, validation, and synthetic generation (schema.md §6).
"""
from typing import List, Dict, Any, Optional, Tuple
from fastapi import FastAPI, UploadFile, File, Query, HTTPException, status, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse, JSONResponse
from pydantic import BaseModel

from .schema import (
    Neighborhood,
    ValidationResult,
    SyntheticGenerationConfig,
    ValidationErrorItem,
    OptimizationConfig,
    OptimizationResult,
    Assignment,
    Warehouse,
    VehicleType,
    ActiveSpill,
    SimulationTickResult,
    OverviewAggregate,
)
from .validation import (validate_neighborhoods, validate_optimization_config,
                         validate_vehicles, validate_warehouses)
from .data_ingestion import (
    parse_csv_content,
    parse_json_content,
    export_to_csv,
    export_to_json,
    compute_dataset_summary,
    parse_vehicles_csv,
    parse_vehicles_json,
    parse_warehouses_csv,
    parse_warehouses_json,
    export_vehicles_to_csv,
    export_warehouses_to_csv,
    compute_fleet_summary,
    compute_warehouse_summary
)
from .synthetic import (generate_synthetic_dataset, generate_synthetic_vehicles,
                        generate_synthetic_warehouses)
from .optimization import run_optimization
from .mapping import prepare_map_layer_data, compute_map_bounds
from . import auth as auth_module

app = FastAPI(
    title="GridPoint API",
    description="Warehouse Location & Assignment Optimization Platform API",
    version="1.0.0"
)

# Enable CORS for frontend integration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ValidateRequest(BaseModel):
    neighborhoods: List[Dict[str, Any]]


class OptimizeRequest(BaseModel):
    neighborhoods: List[Dict[str, Any]]
    config: Optional[OptimizationConfig] = None


class ExportRequest(BaseModel):
    neighborhoods: List[Dict[str, Any]]


class ConfigValidateRequest(BaseModel):
    config: OptimizationConfig
    neighborhoods: List[Dict[str, Any]]


class MapSummaryRequest(BaseModel):
    neighborhoods: List[Dict[str, Any]]
    # Phase B: optional active result — when present the response also carries
    # coverage heatmap cells, corridor traffic buckets, and per-warehouse focus
    # payloads (read-only; no routing/cost changes).
    warehouses: Optional[List[Dict[str, Any]]] = None
    assignments: Optional[List[Dict[str, Any]]] = None
    grid_n: Optional[int] = 24


class MapCoverageRequest(BaseModel):
    neighborhoods: List[Dict[str, Any]]
    assignments: List[Dict[str, Any]] = []
    grid_n: Optional[int] = 24
    top_k: Optional[int] = 0
    pad: Optional[float] = 0.18


class WarehouseFocusRequest(BaseModel):
    warehouse_id: str
    neighborhoods: List[Dict[str, Any]]
    warehouses: List[Dict[str, Any]]
    assignments: List[Dict[str, Any]] = []


@app.get("/api/health")
def health_check():
    return {"status": "ok", "service": "GridPoint Backend", "version": "1.0.0"}


@app.post("/api/map/summary")
def get_map_summary(payload: MapSummaryRequest):
    """
    Computes map bounds, center, zoom, and bubble styling for neighborhood nodes (Phase 2).
    Phase B: when warehouses+assignments are supplied, also returns coverage
    heatmap cells, corridor traffic buckets, and per-warehouse focus payloads.
    """
    from .mapping import (coverage_heatmap, corridor_traffic_summary,
                          warehouse_focus_summary)
    base = prepare_map_layer_data(payload.neighborhoods)
    if not payload.warehouses and not payload.assignments:
        return base
    warehouses = payload.warehouses or []
    assignments = payload.assignments or []
    grid_n = max(4, min(64, int(payload.grid_n or 24)))
    return {
        **base,
        "coverage": coverage_heatmap(payload.neighborhoods, assignments, grid_n=grid_n),
        "traffic": corridor_traffic_summary(assignments),
        "focus": {
            str(w.get("warehouse_id")): warehouse_focus_summary(
                str(w.get("warehouse_id")), payload.neighborhoods, warehouses, assignments)
            for w in warehouses if w.get("warehouse_id") is not None
        },
    }


@app.post("/api/map/coverage")
def get_map_coverage(payload: MapCoverageRequest):
    """Phase B (#2): proximity heatmap grid recomputed from active assignment distances."""
    from .mapping import coverage_heatmap
    grid_n = max(4, min(64, int(payload.grid_n or 24)))
    top_k = max(0, min(50, int(payload.top_k or 0)))
    pad = payload.pad if payload.pad is not None else 0.18
    return coverage_heatmap(payload.neighborhoods, payload.assignments,
                            grid_n=grid_n, top_k=top_k, pad=pad)


@app.post("/api/map/warehouse-focus")
def get_warehouse_focus(payload: WarehouseFocusRequest):
    """Phase B (#1): isolated zone payload for a clicked warehouse."""
    from .mapping import warehouse_focus_summary
    return warehouse_focus_summary(payload.warehouse_id, payload.neighborhoods,
                                   payload.warehouses, payload.assignments)


@app.post("/api/config/validate")
def validate_config(payload: ConfigValidateRequest):
    """
    Validates OptimizationConfig against active neighborhood records (Phase 2/3).
    """
    is_valid, errors, warnings = validate_optimization_config(payload.config, payload.neighborhoods)
    return {
        "valid": is_valid,
        "errors": [e.model_dump() for e in errors],
        "warnings": [w.model_dump() for w in warnings]
    }


@app.post("/api/validate", response_model=ValidationResult)
def validate_dataset(payload: ValidateRequest):
    """Validate a list of neighborhood records against schema rules."""
    result, _ = validate_neighborhoods(payload.neighborhoods)
    return result


@app.post("/api/optimize", response_model=OptimizationResult)
def optimize_network(payload: OptimizeRequest):
    """
    Computes optimal warehouse locations (Weiszfeld for K=1, Weighted K-Means for K>1,
    or PuLP MILP for constrained CFLP) and assigns neighborhoods to optimal facilities (schema.md §6).
    """
    val_res, clean_records = validate_neighborhoods(payload.neighborhoods)
    if not val_res.valid or not clean_records:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "message": "Cannot optimize invalid neighborhood dataset",
                "errors": [e.model_dump() for e in val_res.errors]
            }
        )
    cfg = payload.config or OptimizationConfig()
    return run_optimization(clean_records, cfg)



@app.get("/api/synthetic", response_model=List[Neighborhood])
def get_synthetic_data(
    N: int = Query(50, ge=1, le=5000, description="Number of neighborhoods"),
    lat_center: float = Query(17.385044, ge=-90.0, le=90.0),
    lon_center: float = Query(78.486671, ge=-180.0, le=180.0),
    spread_km: float = Query(20.0, gt=0.0, le=500.0),
    distribution: str = Query("clustered", pattern="^(clustered|uniform|gaussian)$"),
    num_clusters: int = Query(3, ge=1, le=10),
    orders_min: int = Query(10, ge=0),
    orders_max: int = Query(200, ge=1),
    seed: int = Query(42)
):
    """Generate a realistic, seedable synthetic dataset for demo and testing."""
    if orders_min > orders_max:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="orders_min cannot exceed orders_max"
        )

    config = SyntheticGenerationConfig(
        N=N,
        lat_center=lat_center,
        lon_center=lon_center,
        spread_km=spread_km,
        distribution=distribution, # type: ignore
        num_clusters=num_clusters,
        orders_min=orders_min,
        orders_max=orders_max,
        seed=seed
    )
    data = generate_synthetic_dataset(config)
    return [Neighborhood(**item) for item in data]


class VehiclesValidateRequest(BaseModel):
    vehicles: List[Dict[str, Any]]


class WarehousesValidateRequest(BaseModel):
    warehouses: List[Dict[str, Any]]


@app.post("/api/vehicles/validate", response_model=ValidationResult)
def validate_vehicles_endpoint(payload: VehiclesValidateRequest):
    """Validate an owned-fleet dataset (Phase A #4)."""
    result, _ = validate_vehicles(payload.vehicles)
    return result


@app.post("/api/warehouses/validate", response_model=ValidationResult)
def validate_warehouses_endpoint(payload: WarehousesValidateRequest):
    """Validate an existing-warehouse dataset (Phase A #4/#8)."""
    result, _ = validate_warehouses(payload.warehouses)
    return result


@app.get("/api/synthetic/vehicles", response_model=List[VehicleType])
def get_synthetic_vehicles(
    seed: int = Query(42, description="RNG seed for reproducibility"),
    count: int = Query(4, ge=1, le=20, description="Fleet size"),
):
    """Deterministic owned-fleet seeder (Phase A #4). Same seed+count → same fleet."""
    return [VehicleType(**v) for v in generate_synthetic_vehicles(seed=seed, count=count)]


@app.get("/api/synthetic/warehouses", response_model=List[Warehouse])
def get_synthetic_warehouses(
    seed: int = Query(42, description="RNG seed for reproducibility"),
    count: int = Query(2, ge=1, le=10, description="Site count"),
    lat_center: float = Query(17.385044, ge=-90.0, le=90.0),
    lon_center: float = Query(78.486671, ge=-180.0, le=180.0),
    spread_km: float = Query(20.0, gt=0.0, le=500.0),
):
    """Deterministic existing-warehouse seeder (Phase A #4/#8; D-baseline + E keep set)."""
    return [Warehouse(**w) for w in generate_synthetic_warehouses(
        seed=seed, count=count, lat_center=lat_center, lon_center=lon_center, spread_km=spread_km)]


@app.post("/api/export/vehicles")
def export_vehicles(payload: Dict[str, Any]):
    """Export owned-fleet records to canonical CSV."""
    vehicles = payload.get("vehicles", [])
    return PlainTextResponse(content=export_vehicles_to_csv(vehicles), media_type="text/csv")


@app.post("/api/export/warehouses")
def export_warehouses(payload: Dict[str, Any]):
    """Export existing-warehouse records to canonical CSV."""
    warehouses = payload.get("warehouses", [])
    return PlainTextResponse(content=export_warehouses_to_csv(warehouses), media_type="text/csv")


@app.post("/api/upload")
async def upload_file(file: UploadFile = File(...), dataset: str = Query("neighborhoods")):
    """
    Ingest and validate an uploaded CSV or JSON file.
    `?dataset=neighborhoods|vehicles|warehouses` selects the onboarding
    dataset (default neighborhoods for backward compatibility).
    Returns validation result, clean records, and summary.
    """
    contents = await file.read()
    filename = file.filename or ""
    kind = (dataset or "neighborhoods").strip().lower()

    try:
        content_str = contents.decode("utf-8")
    except UnicodeDecodeError:
        try:
            content_str = contents.decode("latin-1")
        except Exception as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Unable to decode file: {str(e)}"
            )

    def _parse_neighborhoods():
        if filename.lower().endswith(".json"):
            return parse_json_content(content_str)
        elif filename.lower().endswith(".csv") or filename.lower().endswith(".txt"):
            return parse_csv_content(content_str)
        val_result, clean_records = parse_json_content(content_str)
        if not val_result.valid and not clean_records:
            val_result, clean_records = parse_csv_content(content_str)
        return val_result, clean_records

    def _parse_vehicles():
        if filename.lower().endswith(".json"):
            return parse_vehicles_json(content_str)
        elif filename.lower().endswith(".csv") or filename.lower().endswith(".txt"):
            return parse_vehicles_csv(content_str)
        val_result, clean_records = parse_vehicles_json(content_str)
        if not val_result.valid and not clean_records:
            val_result, clean_records = parse_vehicles_csv(content_str)
        return val_result, clean_records

    def _parse_warehouses():
        if filename.lower().endswith(".json"):
            return parse_warehouses_json(content_str)
        elif filename.lower().endswith(".csv") or filename.lower().endswith(".txt"):
            return parse_warehouses_csv(content_str)
        val_result, clean_records = parse_warehouses_json(content_str)
        if not val_result.valid and not clean_records:
            val_result, clean_records = parse_warehouses_csv(content_str)
        return val_result, clean_records

    if kind in ("vehicles", "fleet", "vehicle"):
        val_result, clean_records = _parse_vehicles()
        return {"filename": filename, "dataset": "vehicles",
                "validation": val_result.model_dump(), "vehicles": clean_records,
                "summary": compute_fleet_summary(clean_records)}
    if kind in ("warehouses", "warehouse", "existing_warehouses"):
        val_result, clean_records = _parse_warehouses()
        return {"filename": filename, "dataset": "warehouses",
                "validation": val_result.model_dump(), "warehouses": clean_records,
                "summary": compute_warehouse_summary(clean_records)}

    val_result, clean_records = _parse_neighborhoods()
    summary = compute_dataset_summary(clean_records)

    return {
        "filename": filename,
        "dataset": "neighborhoods",
        "validation": val_result.model_dump(),
        "neighborhoods": clean_records,
        "summary": summary
    }


@app.post("/api/export/csv")
def export_csv(payload: ExportRequest):
    """Export neighborhoods to canonical CSV format."""
    csv_text = export_to_csv(payload.neighborhoods)
    return PlainTextResponse(content=csv_text, media_type="text/csv")


@app.post("/api/export/json")
def export_json(payload: ExportRequest):
    """Export neighborhoods to canonical JSON format."""
    json_text = export_to_json(payload.neighborhoods)
    return PlainTextResponse(content=json_text, media_type="application/json")


class MetricsExportRequest(BaseModel):
    result: Dict[str, Any]


@app.post("/api/export/metrics")
def export_metrics(payload: MetricsExportRequest):
    """Export Phase 4 comparison table (baseline vs optimized) as CSV."""
    from .cost import metrics_table_rows
    from .schema import OptimizationResult
    try:
        result = OptimizationResult(**payload.result)
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail=f"Invalid OptimizationResult: {e}")
    if not result.comparison:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="No comparison in result; run optimization first")
    rows = metrics_table_rows(result.comparison.baseline.metrics,
                              result.comparison.optimized.metrics)
    lines = ["metric,baseline,optimized,saved,pct_saved"]
    for r in rows:
        lines.append(f"{r['metric']},{r['baseline']},{r['optimized']},{r['saved']},{r['pct_saved']}")
    # Avg delivery cost per order (Phase D #7): total_cost / Σw_i, orders
    # derived from assignments so the CSV reconciles without extra inputs.
    def _orders(asgs: Any) -> float:
        tot = 0.0
        for a in asgs:
            d = float(a.distance_km) if a.distance_km else 0.0
            tot += (float(a.weighted_distance) / d) if d > 0 else 0.0
        return tot
    b_orders = _orders(result.comparison.baseline.assignments)
    o_orders = _orders(result.assignments)
    b_avg = round(float(result.comparison.baseline.metrics.total_cost) / max(1.0, b_orders), 2)
    o_avg = round(float(result.comparison.optimized.metrics.total_cost) / max(1.0, o_orders), 2)
    lines.append(f"avg_cost_per_order,{b_avg},{o_avg},{round(b_avg - o_avg, 2)},{round((b_avg - o_avg) / max(0.001, b_avg) * 100.0, 2)}")
    lines.append("")
    lines.append("warehouse_id,assigned_orders,utilization_pct,avg_distance_km,neighborhood_count")
    for w in result.metrics.warehouses:
        lines.append(f"{w.warehouse_id},{w.assigned_orders},{w.utilization_pct},{w.avg_distance_km},{w.neighborhood_count}")
    return PlainTextResponse(content="\n".join(lines), media_type="text/csv")


@app.get("/api/fuel/rates")
def fuel_rates(state: str = Query("Karnataka", description="Indian state for fuel rates")):
    """
    Daily petrol/diesel/CNG/autogas ₹/litre by city. Served live from RapidAPI
    when RAPIDAPI_KEY is configured, else static fallbacks with live=false.
    The key is never exposed — only prices leave the server.
    """
    from .fuel import api_key_configured, get_state_rates
    info = get_state_rates(state)
    return {**info, "key_configured": api_key_configured()}


@app.get("/api/fuel/price")
def fuel_price(
    fuel_type: str = Query(..., description="petrol|diesel|cng|autogas"),
    city: Optional[str] = Query(None, description="City (default: first city)"),
    state: str = Query("Karnataka", description="Indian state for fuel rates"),
):
    """Single ₹/litre quote for a fuel type."""
    from .fuel import price_for
    price, live, city_used = price_for(fuel_type, city, state)
    if price is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail=f"Unknown fuel type '{fuel_type}'. Use petrol|diesel|cng|autogas.")
    return {"fuel_type": fuel_type.strip().lower(), "price_per_litre": price,
            "live": live, "city": city_used, "state": state}


@app.get("/api/traffic/flow")
def traffic_flow(lat: float = Query(..., ge=-90.0, le=90.0),
                 lon: float = Query(..., ge=-180.0, le=180.0)):
    """
    Live TomTom flow segment for a point (TTL-cached). Key stays server-side;
    without it returns live=false. Feeds the map's congestion coloring.
    """
    from .traffic import api_key_configured, get_flow
    info = get_flow(lat, lon)
    return {**info, "lat": lat, "lon": lon, "key_configured": api_key_configured()}


@app.get("/api/traffic/history")
def traffic_history(lat: float = Query(..., ge=-90.0, le=90.0),
                    lon: float = Query(..., ge=-180.0, le=180.0),
                    hour: Optional[int] = Query(None, ge=0, le=23,
                                               description="Hour of day (default: now)")):
    """Rolling historical congestion factor for a corridor cell × hour."""
    from .traffic import cell_of, historical_factor
    factor, samples = historical_factor(lat, lon, hour)
    return {"cell": cell_of(lat, lon), "hour": hour, "factor": factor, "samples": samples}


class CorridorTrafficRequest(BaseModel):
    neighborhoods: List[Dict[str, Any]] = []
    warehouses: List[Warehouse] = []
    assignments: List[Assignment] = []
    hour: Optional[int] = None
    samples_per_corridor: int = 3
    use_live: Optional[bool] = None


@app.post("/api/traffic/corridors")
def traffic_corridors(payload: CorridorTrafficRequest):
    """
    Phase C (#5 engine): per-corridor congestion aggregated from traced road
    geometries (node + midpoint + warehouse samples per assigned corridor).
    Live readings persist into rolling history; offline runs degrade to
    history + manual floor with live=false. Feeds the map overlay (Phase B
    reads it) and "optimize on current traffic" (engine reads it).
    """
    from .traffic import corridor_traffic_from_assignments
    if not payload.warehouses:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="No warehouses provided")
    cfg_hour = payload.hour
    allow_live = True if payload.use_live is None else bool(payload.use_live)
    try:
        corridors = corridor_traffic_from_assignments(
            payload.neighborhoods,
            [w.model_dump() for w in payload.warehouses],
            [a.model_dump() for a in payload.assignments],
            manual_floor=0.0, hour=cfg_hour, record=True,
            allow_live=allow_live,
            samples_per_corridor=max(2, min(7, int(payload.samples_per_corridor or 3))))
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))
    factors = {wid: info["factor"] for wid, info in corridors.items()}
    live_count = sum(1 for info in corridors.values() if info.get("live"))
    avg_cong = round(sum(factors.values()) / max(1, len(factors)), 4) if factors else 0.0
    return {
        "corridors": corridors,
        "factors": factors,
        "avg_congestion_pct": avg_cong,
        "live_corridors": live_count,
        "total_corridors": len(corridors),
        "note": ("Live corridor segments" if live_count
                 else "History + manual floor (live traffic unreachable)"),
    }


class RerouteRequest(BaseModel):
    neighborhoods: List[Dict[str, Any]]
    warehouses: List[Warehouse]
    assignments: List[Assignment]
    config: Optional[OptimizationConfig] = None
    alpha: float = 1.0
    beta_per_min: float = 0.5
    congestion_overrides: Optional[Dict[str, float]] = None


@app.post("/api/routes/reroute")
def reroute_on_traffic(payload: RerouteRequest):
    """
    Phase C (#9): dynamic reroute — re-evaluate assignment as corridor
    conditions change, minimizing score = alpha * cost + beta * time.
    Sites stay fixed; only neighborhood→warehouse mapping moves. Surfaces
    changed assignments + saved minutes/₹ with full re-evaluated metrics.
    """
    import numpy as np
    from .cost import compute_metrics, resolve_fuel_prices
    from .distance import compute_distance_matrix
    from .optimization import (
        estimate_time_min,
        fleet_avg_speed_kmph,
        reroute_assignments,
        resolve_live_traffic,
    )
    if not payload.neighborhoods:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="No neighborhoods provided")
    if not payload.warehouses:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="No warehouses provided — run optimization first")
    if not payload.assignments:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="No assignments provided — run optimization first")
    cfg = payload.config or OptimizationConfig()
    alpha = max(0.0, float(payload.alpha or 0.0)) or 1.0
    beta = max(0.0, float(payload.beta_per_min or 0.0))
    if beta == 0.0:
        beta = 0.5

    wh_ids = [str(w.warehouse_id) for w in payload.warehouses]
    wh_index = {wid: k for k, wid in enumerate(wh_ids)}
    try:
        coords = np.array([[float(n.get("latitude")), float(n.get("longitude"))]
                           for n in payload.neighborhoods])
        weights = np.array([float(n.get("daily_orders", 0) or 0)
                            for n in payload.neighborhoods])
        wh_coords = np.array([[float(w.latitude), float(w.longitude)]
                              for w in payload.warehouses])
    except (TypeError, ValueError) as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail=f"Invalid coordinates: {e}")

    # Current labels from the submitted assignment (unknown ids → nearest).
    cur = np.zeros(len(payload.neighborhoods), dtype=int)
    nb_ids = [str(n.get("neighborhood_id")) for n in payload.neighborhoods]
    nb_row = {nid: i for i, nid in enumerate(nb_ids)}
    fallback_dists = compute_distance_matrix(coords, wh_coords, metric="haversine")
    for a in payload.assignments:
        row = nb_row.get(str(a.neighborhood_id))
        if row is None:
            continue
        cur[row] = wh_index.get(str(a.warehouse_id),
                                int(np.argmin(fallback_dists[row])))

    # Corridor congestion: explicit overrides win, else live/history per site.
    from .traffic import corridor_factor
    corridor: Dict[int, float] = {}
    live_n = 0
    overrides = dict(payload.congestion_overrides or {})
    for k, w in enumerate(payload.warehouses):
        if w.warehouse_id in overrides:
            corridor[k] = max(0.0, float(overrides[w.warehouse_id]))
            continue
        info = corridor_factor(float(w.latitude), float(w.longitude),
                               manual_floor=float(cfg.traffic_factor or 0.0),
                               hour=cfg.traffic_hour, record=True,
                               allow_live=resolve_live_traffic(cfg))
        corridor[k] = float(info.get("factor", 0.0) or 0.0)
        live_n += 1 if info.get("live") else 0

    fuel_prices, fuel_live, fuel_note = resolve_fuel_prices(cfg)
    dur = None
    if cfg.distance_metric == "road":
        from .routing import road_matrices
        dist, dur, road_note = road_matrices(
            coords, wh_coords, live_traffic=resolve_live_traffic(cfg))
    else:
        dist = compute_distance_matrix(coords, wh_coords, metric=cfg.distance_metric)
        road_note = None

    try:
        new_labels, summary = reroute_assignments(
            coords, weights, wh_coords, cur, cfg, corridor=corridor,
            dist_matrix=dist, dur_matrix=dur, fuel_prices=fuel_prices,
            alpha=alpha, beta_per_min=beta)
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))

    from .optimization import evaluate_network_layout
    notes: List[str] = []
    if road_note and road_note not in notes:
        notes.append(road_note)
    new_wh, new_asg, new_metrics = evaluate_network_layout(
        payload.neighborhoods, wh_coords, new_labels, cfg,
        fuel_prices=fuel_prices, fuel_live=fuel_live,
        corridor=corridor, notes=notes)
    # Restore caller warehouse ids (evaluate builds W1..WK in order).
    id_map = {f"W{k+1}": wh_ids[k] for k in range(len(wh_ids))}
    for a in new_asg:
        a.warehouse_id = id_map.get(a.warehouse_id, a.warehouse_id)
    for w_new, wid in zip(new_wh, wh_ids):
        w_new.warehouse_id = wid
    for wm, wid in zip(new_metrics.warehouses, wh_ids):
        wm.warehouse_id = wid

    moved_ids = [nb_ids[i] for i in summary.get("moved_idx", [])
                 if 0 <= i < len(nb_ids)]
    speed = fleet_avg_speed_kmph(cfg)
    # Report time in provider minutes when road durations exist, else estimates.
    traffic_note = (
        f"Reroute on {'live' if live_n else 'history/manual'} corridors "
        f"({live_n}/{len(wh_ids)} live, {speed:.0f} km/h fleet speed)")
    return {
        "assignments": [a.model_dump() for a in new_asg],
        "warehouses": [w.model_dump() for w in new_wh],
        "metrics": new_metrics.model_dump(),
        "changed": summary.get("changed", 0),
        "moved_neighborhood_ids": moved_ids,
        "saved_cost": summary.get("saved_cost", 0.0),
        "saved_minutes": summary.get("saved_minutes", 0.0),
        "old_cost": summary.get("old_cost", 0.0),
        "new_cost": summary.get("new_cost", 0.0),
        "old_minutes": summary.get("old_minutes", 0.0),
        "new_minutes": summary.get("new_minutes", 0.0),
        "alpha": alpha,
        "beta_per_min": beta,
        "traffic_note": traffic_note,
        "fuel_note": fuel_note,
        "routing_note": "; ".join(notes) if notes else None,
    }


@app.get("/api/census/cities")
def census_cities():
    """Seedable US metros with real Census demand (no network, no key needed)."""
    from .census import api_key_configured, list_cities
    return {"cities": list_cities(), "key_configured": api_key_configured()}


@app.get("/api/census/demand")
def census_demand(
    city: str = Query(..., description="City id from /api/census/cities"),
    orders_per_1000: float = Query(5.0, gt=0.0, le=1000.0,
                                   description="Daily orders per 1,000 residents"),
):
    """
    Real demand nodes: ACS tract populations × rate, joined to Gazetteer
    centroids. The key is never exposed — only demand leaves the server.
    """
    from .census import get_city_demand
    try:
        return get_city_demand(city.strip().lower(), orders_per_1000)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(e))


class RouteGeometryRequest(BaseModel):
    # Loose input shape validated manually below so failures are always
    # 400s with plain-string details (never FastAPI 422 detail arrays,
    # which stringify to "[object Object], ..." on the client).
    pairs: List[Any]
    live_traffic: bool = False


def _parse_route_pair(p: Any, i: int) -> Tuple[float, float, float, float]:
    def num(v: Any, name: str) -> float:
        try:
            f = float(v)
        except (TypeError, ValueError):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                                detail=f"Pair #{i}: '{name}' must be a number.")
        if not (-90.0 <= f <= 90.0 if "lat" in name else -180.0 <= f <= 180.0):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                                detail=f"Pair #{i}: '{name}' out of range.")
        if f != f:  # NaN guard
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                                detail=f"Pair #{i}: '{name}' must be a number.")
        return f

    if not isinstance(p, dict):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail=f"Pair #{i}: expected {{frm|from:{{lat,lon}}, to:{{lat,lon}}}}.")
    try:
        # Phase B (#3): accept BOTH spellings — legacy {frm} and client {from}.
        frm = p.get("frm", p.get("from"))
        to = p.get("to")
        if frm is None or to is None:
            raise KeyError("frm/from or to")
        flat, flon = frm["lat"], frm["lon"]
        tlat, tlon = to["lat"], to["lon"]
    except (KeyError, TypeError):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail=f"Pair #{i}: expected {{frm|from:{{lat,lon}}, to:{{lat,lon}}}}.")
    return (num(flat, "frm.lat"), num(flon, "frm.lon"),
            num(tlat, "to.lat"), num(tlon, "to.lon"))


@app.post("/api/routes/geometry")
def route_geometries(payload: RouteGeometryRequest):
    """
    Driving path per origin→destination pair ([[lon, lat], ...] + distance +
    duration). TomTom first (live when requested + keyed), OSRM fallback,
    straight line last resort. Capped per request for quota/latency.
    """
    from concurrent.futures import ThreadPoolExecutor
    from .routing import MAX_ROUTE_PAIRS_PER_CALL, route_geometry
    if len(payload.pairs) > MAX_ROUTE_PAIRS_PER_CALL:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail=f"Max {MAX_ROUTE_PAIRS_PER_CALL} pairs per request.")
    parsed = [_parse_route_pair(p, i) for i, p in enumerate(payload.pairs)]
    # I/O-bound provider calls run in parallel; order preserved for 1:1
    # mapping with the request pairs. Keeps large batches inside serverless
    # execution limits (a 55-pair batch drops from ~34s to ~5s).
    with ThreadPoolExecutor(max_workers=8) as pool:
        out = list(pool.map(
            lambda q: route_geometry((q[0], q[1]), (q[2], q[3]),
                                     live_traffic=payload.live_traffic),
            parsed,
        ))
    return {"routes": out}


@app.post("/api/export/assignments")
def export_assignments(payload: MetricsExportRequest):
    """Export full neighborhood→warehouse assignment table as CSV (map lines match table).

    Every row carries road distance_km + fuel_cost + cost (Phase D #7) plus
    congestion / travel-time provenance when present, so the CSV reconciles
    to the ComparisonDashboard per-node table row-for-row.
    """
    from .schema import OptimizationResult
    try:
        result = OptimizationResult(**payload.result)
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail=f"Invalid OptimizationResult: {e}")
    lines = ["neighborhood_id,warehouse_id,distance_km,weighted_distance,fuel_cost,cost,avg_cost_per_order,congestion_pct,travel_time_min,within_radius,is_feasible"]
    for a in result.assignments:
        w_i = (float(a.weighted_distance) / float(a.distance_km)) if float(a.distance_km) > 0 else 0.0
        avg = round(float(a.cost) / max(1.0, w_i), 2) if w_i > 0 else float(a.cost)
        cong = "" if a.congestion_pct is None else a.congestion_pct
        tmin = "" if a.travel_time_min is None else a.travel_time_min
        lines.append(f"{a.neighborhood_id},{a.warehouse_id},{a.distance_km},{a.weighted_distance},{a.fuel_cost},{a.cost},{avg},{cong},{tmin},{a.within_radius},{a.is_feasible}")
    return PlainTextResponse(content="\n".join(lines), media_type="text/csv")


class TradeoffRequest(BaseModel):
    neighborhoods: List[Dict[str, Any]]
    config: OptimizationConfig
    max_k: Optional[int] = 6


class DemandShiftRequest(BaseModel):
    neighborhoods: List[Dict[str, Any]]
    pct_delta: float


class FleetETARequest(BaseModel):
    assignments: List[Assignment]
    config: OptimizationConfig
    vehicle_type: Optional[str] = None
    # Phase C (#12 engine half): live-feed ETA needs no manual slider —
    # pass warehouses so missing per-assignment congestion resolves from
    # live TomTom + history instead of the manual traffic_factor floor.
    warehouses: List[Warehouse] = []
    use_live_feeds: Optional[bool] = None
    congestion_overrides: Optional[Dict[str, float]] = None


class DiagnosticsRequest(BaseModel):
    warehouses: List[Warehouse]
    assignments: List[Assignment]
    config: OptimizationConfig


# ---------------------------------------------------------------------------
# Auth (JWT, backend-only per schema — see backend/src/auth.py)
# ---------------------------------------------------------------------------

class SignupRequest(BaseModel):
    name: str
    email: str
    password: str


class LoginRequest(BaseModel):
    email: str
    password: str


def _bearer_token(auth_header: Optional[str]) -> Optional[str]:
    if not auth_header:
        return None
    parts = auth_header.split()
    if len(parts) == 2 and parts[0].lower() == "bearer":
        return parts[1]
    return None


@app.post("/api/auth/signup")
def auth_signup(payload: SignupRequest):
    user, err = auth_module.signup_user(payload.name, payload.email, payload.password)
    if err:
        code = status.HTTP_409_CONFLICT if "already exists" in err else status.HTTP_400_BAD_REQUEST
        raise HTTPException(status_code=code, detail=err)
    token = auth_module.create_access_token(user["id"], user["email"])
    return {"token": token, "user": auth_module.public_user(user)}


@app.post("/api/auth/login")
def auth_login(payload: LoginRequest):
    user, err = auth_module.authenticate_user(payload.email, payload.password)
    if err:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=err)
    token = auth_module.create_access_token(user["id"], user["email"])
    return {"token": token, "user": auth_module.public_user(user)}


@app.get("/api/auth/me")
def auth_me(request: Request):
    token = _bearer_token(request.headers.get("authorization"))
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing bearer token")
    payload = auth_module.decode_token(token)
    if not payload:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")
    user = auth_module.get_user(payload.get("email") or "")
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User no longer exists")
    return auth_module.public_user(user)


@app.post("/api/scenarios/tradeoff")
def get_tradeoff_curve(payload: TradeoffRequest):
    """
    Computes delivery vs infrastructure cost trade-off across K in [1, max_k] (Phase 5 Bonus 8).
    """
    from .scenarios import compute_tradeoff_curve
    try:
        return compute_tradeoff_curve(payload.neighborhoods, payload.config, max_k=payload.max_k or 6)
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@app.post("/api/scenarios/demand-shift")
def apply_demand_shift(payload: DemandShiftRequest):
    """
    Simulates customer demand shifts w_i' = w_i * (1 + delta%) (Phase 5 Bonus 7).
    """
    from .scenarios import simulate_demand_shift
    try:
        shifted, stats = simulate_demand_shift(payload.neighborhoods, payload.pct_delta)
        return {"neighborhoods": shifted, "stats": stats}
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@app.post("/api/scenarios/eta")
def get_fleet_eta(payload: FleetETARequest):
    """
    Computes delivery ETA and fuel consumption under traffic and vehicle specs (Phase 5 Bonus 4/5/6).
    Phase C (#12 engine half): with warehouses supplied, missing congestion
    resolves from live feeds — no manual slider required in the engine path.
    """
    from .scenarios import calculate_fleet_eta
    try:
        return calculate_fleet_eta(payload.assignments, payload.config, payload.vehicle_type,
                                   warehouses=payload.warehouses,
                                   use_live_feeds=payload.use_live_feeds,
                                   congestion_overrides=payload.congestion_overrides)
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@app.post("/api/scenarios/diagnostics")
def get_constraint_diagnostics(payload: DiagnosticsRequest):
    """
    Evaluates warehouse capacity overflow and radius violations (Phase 5 Bonus 2/3).
    """
    from .scenarios import diagnose_constraints
    try:
        return diagnose_constraints(payload.warehouses, payload.assignments, payload.config)
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


class ExpandRequest(BaseModel):
    neighborhoods: List[Dict[str, Any]]
    warehouses: List[Warehouse]
    add_count: int = 1
    config: Optional[OptimizationConfig] = None
    # Phase-E policy toggles (schema.md §2.4 expansion_policy, planned).
    # Accepted as a plain dict so Phase-A onboarding shapes stay forward-compat:
    # {allow_abandon_infra, allow_sell_vehicles, horizon_months,
    #  revenue_per_order, demolition_cost, salvage_value, resale_value,
    #  infra_cost_new, vehicle_cost_new}. Unknown keys are ignored.
    policy: Optional[Dict[str, Any]] = None
    # Owned-fleet rows (Phase-A VehicleType shape) carried as the keep/sell basis.
    owned_vehicles: Optional[List[Dict[str, Any]]] = None

@app.post("/api/expand")
def expand_warehouses(payload: ExpandRequest):
    """
    Incrementally add warehouses to an existing layout. Current warehouses
    keep their ids/coordinates; new sites relieve the heaviest loads or cover
    poorly served areas, and serving assignments are recomputed.
    With `policy`, also returns a ranked NPV recommendation (keep vs
    abandon/change/demolish vs sell) with a costed rationale.
    """
    from .expansion import expand_network
    try:
        return expand_network(
            payload.neighborhoods,
            [w.model_dump() for w in payload.warehouses],
            payload.add_count,
            payload.config or OptimizationConfig(),
            policy=payload.policy,
            owned_vehicles=payload.owned_vehicles,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


# ---------------------------------------------------------------------------
# Phase F — Realtime Automation & Overview (#12, #13, #14)
# ---------------------------------------------------------------------------

class SimulationTickRequest(BaseModel):
    neighborhoods: List[Dict[str, Any]]
    warehouses: List[Warehouse] = []
    assignments: List[Assignment] = []
    config: Optional[OptimizationConfig] = None
    tick: int = 0
    active_spills: Dict[str, ActiveSpill] = {}
    congestion_overrides: Optional[Dict[str, float]] = None
    scale_demand: bool = True
    demand_amplitude: float = 1.0
    simulate_surge: bool = True


class LiveSnapshotRequest(BaseModel):
    neighborhoods: List[Dict[str, Any]] = []
    warehouses: List[Warehouse] = []
    config: Optional[OptimizationConfig] = None


class OverviewRequest(BaseModel):
    neighborhoods: List[Dict[str, Any]] = []
    warehouses: List[Warehouse] = []
    assignments: List[Assignment] = []
    config: Optional[OptimizationConfig] = None
    active_spills: Dict[str, ActiveSpill] = {}


@app.post("/api/simulation/tick", response_model=SimulationTickResult)
def simulation_tick(payload: SimulationTickRequest):
    """
    One realtime poll tick: scale w_i from the demand signal, read corridor
    congestion per warehouse, and spill nodes off congested warehouses
    (threshold + hysteresis + cooldown). Stateless — the client sends tick +
    active_spills and appends returned events to its log.
    """
    from .simulation import (
        scale_demand_for_tick,
        spillover_reassign,
        warehouse_congestion,
    )
    from .cost import compute_metrics, resolve_fuel_prices
    from .schema import Neighborhood as NBModel

    if not payload.neighborhoods:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="No neighborhoods provided")
    cfg = payload.config or OptimizationConfig()
    if not payload.warehouses:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="No warehouses provided — run optimization first")

    if cfg.simulation_mode == "realtime" and payload.scale_demand:
        scaled, demand_note = scale_demand_for_tick(
            payload.neighborhoods, payload.tick,
            amplitude=max(0.0, min(2.0, payload.demand_amplitude)))
    else:
        scaled, demand_note = payload.neighborhoods, "Simulation off — demand frozen (manual overrides only)"

    congestion, live_flags, traffic_note = warehouse_congestion(
        payload.warehouses, cfg,
        congestion_overrides=payload.congestion_overrides,
        tick=payload.tick, simulate_surge=payload.simulate_surge)

    base_assignments = payload.assignments
    if not base_assignments:
        # No assignment yet: fast nearest-by-metric layout on scaled demand.
        opt = run_optimization(scaled, cfg)
        base_assignments = opt.assignments
        fuel_note = opt.fuel_note
    else:
        fuel_note = None

    # Demand rescale changes w_i but not geometry: refresh weighted_distance
    # + cost on the scaled demand before spilling so metrics reconcile.
    demand_by_id = {str(n.get("neighborhood_id")): int(n.get("daily_orders", 0) or 0)
                    for n in scaled}
    if payload.assignments and (cfg.simulation_mode == "realtime" and payload.scale_demand):
        from .cost import assignment_cost, assignment_fuel_cost
        from .distance import compute_distance_matrix
        import numpy as np
        try:
            nb_coords = np.array([[float(n.get("latitude")), float(n.get("longitude"))] for n in scaled])
            wh_coords = np.array([[float(w.latitude), float(w.longitude)] for w in payload.warehouses])
            wh_ids = [str(w.warehouse_id) for w in payload.warehouses]
            dist = compute_distance_matrix(nb_coords, wh_coords, metric="haversine" if cfg.distance_metric == "road" else cfg.distance_metric)
            prices, _, _ = resolve_fuel_prices(cfg)
            refreshed = []
            for a in base_assignments:
                nid = str(a.neighborhood_id)
                try:
                    row = [str(n.get("neighborhood_id")) for n in scaled].index(nid)
                    col = wh_ids.index(str(a.warehouse_id))
                    d = float(dist[row][col])
                except (ValueError, IndexError):
                    d = float(a.distance_km)
                w_i = demand_by_id.get(nid, 0)
                cong = congestion.get(str(a.warehouse_id))
                refreshed.append(Assignment(
                    neighborhood_id=nid, warehouse_id=str(a.warehouse_id),
                    distance_km=round(d, 2),
                    weighted_distance=round(w_i * d, 2),
                    cost=round(assignment_cost(w_i, d, cfg, prices, cong), 2),
                    fuel_cost=round(assignment_fuel_cost(w_i, d, cfg, prices, cong), 2),
                    congestion_pct=cong, travel_time_min=a.travel_time_min,
                    within_radius=a.within_radius, is_feasible=a.is_feasible))
            base_assignments = refreshed
        except Exception:
            pass

    new_assignments, new_spills, events = spillover_reassign(
        scaled, payload.warehouses, base_assignments, congestion, cfg,
        payload.active_spills or {}, payload.tick)

    try:
        metrics = compute_metrics(scaled, new_assignments, payload.warehouses, cfg)
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))

    if fuel_note is None:
        _, _, fuel_note = resolve_fuel_prices(cfg)

    return SimulationTickResult(
        tick=payload.tick, simulation_mode=cfg.simulation_mode,
        neighborhoods=[NBModel(**n) for n in scaled],
        assignments=new_assignments, metrics=metrics,
        congestion_by_warehouse={k: round(v, 4) for k, v in congestion.items()},
        congestion_live={k: bool(v) for k, v in live_flags.items()},
        events=events, active_spills=new_spills,
        demand_note=demand_note, traffic_note=traffic_note, fuel_note=fuel_note)


@app.post("/api/simulation/live")
def simulation_live(payload: LiveSnapshotRequest):
    """One poll-tick live snapshot: fuel + corridor traffic + demand totals."""
    from .simulation import live_snapshot
    try:
        return live_snapshot(payload.neighborhoods, payload.warehouses,
                             payload.config or OptimizationConfig())
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@app.post("/api/overview", response_model=OverviewAggregate)
def get_overview(payload: OverviewRequest):
    """Overview aggregate for the Overview tab (schema.md §2.9, #14)."""
    from .simulation import build_overview
    try:
        return build_overview(
            payload.neighborhoods, payload.warehouses, payload.assignments,
            payload.config or OptimizationConfig(),
            active_spills=payload.active_spills or {})
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))

