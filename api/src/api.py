"""
GridPoint FastAPI Backend
Provides REST endpoints for data ingestion, validation, and synthetic generation (schema.md §6).
"""
from typing import List, Dict, Any, Optional
from fastapi import FastAPI, UploadFile, File, Query, HTTPException, status
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
    Warehouse
)
from .validation import validate_neighborhoods, validate_optimization_config
from .data_ingestion import (
    parse_csv_content,
    parse_json_content,
    export_to_csv,
    export_to_json,
    compute_dataset_summary
)
from .synthetic import generate_synthetic_dataset
from .optimization import run_optimization
from .mapping import prepare_map_layer_data, compute_map_bounds

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


@app.get("/api/health")
def health_check():
    return {"status": "ok", "service": "GridPoint Backend", "version": "1.0.0"}


@app.post("/api/map/summary")
def get_map_summary(payload: MapSummaryRequest):
    """
    Computes map bounds, center, zoom, and bubble styling for neighborhood nodes (Phase 2).
    """
    return prepare_map_layer_data(payload.neighborhoods)


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


@app.post("/api/upload")
async def upload_file(file: UploadFile = File(...)):
    """
    Ingest and validate an uploaded CSV or JSON file.
    Returns validation result, clean records, and spatial summary.
    """
    contents = await file.read()
    filename = file.filename or ""

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

    if filename.lower().endswith(".json"):
        val_result, clean_records = parse_json_content(content_str)
    elif filename.lower().endswith(".csv") or filename.lower().endswith(".txt"):
        val_result, clean_records = parse_csv_content(content_str)
    else:
        # Try JSON first, then CSV fallback
        val_result, clean_records = parse_json_content(content_str)
        if not val_result.valid and not clean_records:
            val_result, clean_records = parse_csv_content(content_str)

    summary = compute_dataset_summary(clean_records)

    return {
        "filename": filename,
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


@app.post("/api/export/assignments")
def export_assignments(payload: MetricsExportRequest):
    """Export full neighborhood→warehouse assignment table as CSV (map lines match table)."""
    from .schema import OptimizationResult
    try:
        result = OptimizationResult(**payload.result)
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail=f"Invalid OptimizationResult: {e}")
    lines = ["neighborhood_id,warehouse_id,distance_km,weighted_distance,cost,within_radius,is_feasible"]
    for a in result.assignments:
        lines.append(f"{a.neighborhood_id},{a.warehouse_id},{a.distance_km},{a.weighted_distance},{a.cost},{a.within_radius},{a.is_feasible}")
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


class DiagnosticsRequest(BaseModel):
    warehouses: List[Warehouse]
    assignments: List[Assignment]
    config: OptimizationConfig


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
    """
    from .scenarios import calculate_fleet_eta
    try:
        return calculate_fleet_eta(payload.assignments, payload.config, payload.vehicle_type)
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


@app.post("/api/expand")
def expand_warehouses(payload: ExpandRequest):
    """
    Incrementally add warehouses to an existing layout. Current warehouses
    keep their ids/coordinates; new sites relieve the heaviest loads or cover
    poorly served areas, and serving assignments are recomputed.
    """
    from .expansion import expand_network
    try:
        return expand_network(
            payload.neighborhoods,
            [w.model_dump() for w in payload.warehouses],
            payload.add_count,
            payload.config or OptimizationConfig(),
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))

