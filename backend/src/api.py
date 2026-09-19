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
    OptimizationResult
)
from .validation import validate_neighborhoods
from .data_ingestion import (
    parse_csv_content,
    parse_json_content,
    export_to_csv,
    export_to_json,
    compute_dataset_summary
)
from .synthetic import generate_synthetic_dataset
from .optimization import run_optimization

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


@app.get("/api/health")
def health_check():
    return {"status": "ok", "service": "GridPoint Backend", "version": "1.0.0"}


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
