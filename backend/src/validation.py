"""
GridPoint Validation Engine
Enforces all validation rules defined in schema.md §4.
"""
from typing import List, Dict, Any, Tuple, Optional, Union
import pandas as pd
import numpy as np
from .schema import ValidationErrorItem, ValidationResult, OptimizationConfig


def validate_neighborhood_row(row: Dict[str, Any], row_idx: Optional[int] = None) -> List[ValidationErrorItem]:
    """Validate a single neighborhood dictionary record."""
    errors: List[ValidationErrorItem] = []

    # 1. neighborhood_id check
    nid = row.get("neighborhood_id")
    if nid is None or str(nid).strip() == "" or (isinstance(nid, float) and np.isnan(nid)):
        errors.append(ValidationErrorItem(
            row=row_idx,
            field="neighborhood_id",
            value=nid,
            error="neighborhood_id is required, non-empty, and must be a unique string",
            code="NULL_OR_EMPTY"
        ))

    # 2. latitude check [-90.0, 90.0]
    lat = row.get("latitude")
    if lat is None or (isinstance(lat, float) and np.isnan(lat)):
        errors.append(ValidationErrorItem(
            row=row_idx,
            field="latitude",
            value=lat,
            error="latitude is required and cannot be null",
            code="NULL_VALUE"
        ))
    else:
        try:
            lat_float = float(lat)
            if not (-90.0 <= lat_float <= 90.0):
                errors.append(ValidationErrorItem(
                    row=row_idx,
                    field="latitude",
                    value=lat,
                    error="latitude must be in [-90.0, 90.0] WGS84 range",
                    code="OUT_OF_RANGE"
                ))
        except (ValueError, TypeError):
            errors.append(ValidationErrorItem(
                row=row_idx,
                field="latitude",
                value=lat,
                error=f"latitude '{lat}' is not a valid number",
                code="INVALID_TYPE"
            ))

    # 3. longitude check [-180.0, 180.0]
    lon = row.get("longitude")
    if lon is None or (isinstance(lon, float) and np.isnan(lon)):
        errors.append(ValidationErrorItem(
            row=row_idx,
            field="longitude",
            value=lon,
            error="longitude is required and cannot be null",
            code="NULL_VALUE"
        ))
    else:
        try:
            lon_float = float(lon)
            if not (-180.0 <= lon_float <= 180.0):
                errors.append(ValidationErrorItem(
                    row=row_idx,
                    field="longitude",
                    value=lon,
                    error="longitude must be in [-180.0, 180.0] WGS84 range",
                    code="OUT_OF_RANGE"
                ))
        except (ValueError, TypeError):
            errors.append(ValidationErrorItem(
                row=row_idx,
                field="longitude",
                value=lon,
                error=f"longitude '{lon}' is not a valid number",
                code="INVALID_TYPE"
            ))

    # 4. daily_orders check (integer >= 0)
    orders = row.get("daily_orders")
    if orders is None or (isinstance(orders, float) and np.isnan(orders)):
        errors.append(ValidationErrorItem(
            row=row_idx,
            field="daily_orders",
            value=orders,
            error="daily_orders is required and cannot be null",
            code="NULL_VALUE"
        ))
    else:
        try:
            orders_float = float(orders)
            if orders_float < 0:
                errors.append(ValidationErrorItem(
                    row=row_idx,
                    field="daily_orders",
                    value=orders,
                    error="daily_orders must be a non-negative integer (>= 0)",
                    code="OUT_OF_RANGE"
                ))
            elif not orders_float.is_integer():
                errors.append(ValidationErrorItem(
                    row=row_idx,
                    field="daily_orders",
                    value=orders,
                    error="daily_orders must be an integer count",
                    code="INVALID_ORDERS"
                ))
        except (ValueError, TypeError):
            errors.append(ValidationErrorItem(
                row=row_idx,
                field="daily_orders",
                value=orders,
                error=f"daily_orders '{orders}' is not a valid number",
                code="INVALID_TYPE"
            ))

    return errors


def validate_neighborhoods(
    data: Union[List[Dict[str, Any]], pd.DataFrame]
) -> Tuple[ValidationResult, List[Dict[str, Any]]]:
    """
    Validates an entire dataset of neighborhoods.
    Returns (ValidationResult, sanitized_clean_records).
    """
    if isinstance(data, pd.DataFrame):
        records = data.to_dict(orient="records")
    else:
        records = list(data)

    total_rows = len(records)
    if total_rows == 0:
        empty_err = ValidationErrorItem(
            row=None,
            field="dataset",
            value=0,
            error="Dataset is empty. At least 1 neighborhood record is required.",
            code="EMPTY_DATASET"
        )
        return ValidationResult(
            valid=False,
            errors=[empty_err],
            warnings=[],
            total_rows=0,
            valid_rows=0
        ), []

    all_errors: List[ValidationErrorItem] = []
    all_warnings: List[ValidationErrorItem] = []
    seen_ids: Dict[str, int] = {}
    valid_records: List[Dict[str, Any]] = []

    for idx, row in enumerate(records):
        row_num = idx + 1  # 1-indexed for user-friendly UI display
        row_errors = validate_neighborhood_row(row, row_idx=row_num)

        # Duplicate ID check
        nid = row.get("neighborhood_id")
        if nid is not None and str(nid).strip() != "":
            str_nid = str(nid).strip()
            if str_nid in seen_ids:
                row_errors.append(ValidationErrorItem(
                    row=row_num,
                    field="neighborhood_id",
                    value=str_nid,
                    error=f"Duplicate neighborhood_id '{str_nid}' (previously seen on row {seen_ids[str_nid]})",
                    code="DUPLICATE_ID"
                ))
            else:
                seen_ids[str_nid] = row_num

        if row_errors:
            all_errors.extend(row_errors)
        else:
            # Record is clean, normalize fields
            cleaned_row = {
                "neighborhood_id": str(row["neighborhood_id"]).strip(),
                "name": str(row.get("name") or row["neighborhood_id"]).strip(),
                "latitude": float(row["latitude"]),
                "longitude": float(row["longitude"]),
                "daily_orders": int(float(row["daily_orders"])),
                "zone": str(row.get("zone")).strip() if row.get("zone") else None
            }
            valid_records.append(cleaned_row)

    is_valid = len(all_errors) == 0

    return ValidationResult(
        valid=is_valid,
        errors=all_errors,
        warnings=all_warnings,
        total_rows=total_rows,
        valid_rows=len(valid_records)
    ), valid_records


def validate_optimization_config(
    config: OptimizationConfig,
    neighborhoods: List[Dict[str, Any]]
) -> Tuple[bool, List[ValidationErrorItem], List[ValidationErrorItem]]:
    """
    Validates optimization configuration against dataset constraints (schema.md §4).
    """
    errors: List[ValidationErrorItem] = []
    warnings: List[ValidationErrorItem] = []

    # Check K range 1 to 10
    if not (1 <= config.K <= 10):
        errors.append(ValidationErrorItem(
            field="K",
            value=config.K,
            error=f"Number of warehouses K must be between 1 and 10, got {config.K}",
            code="INVALID_K"
        ))

    # K cannot exceed number of demand nodes
    if len(neighborhoods) > 0 and config.K > len(neighborhoods):
        errors.append(ValidationErrorItem(
            field="K",
            value=config.K,
            error=f"K ({config.K}) cannot exceed the total number of neighborhoods ({len(neighborhoods)})",
            code="K_EXCEEDS_NODES"
        ))

    total_demand = sum(int(n.get("daily_orders", 0)) for n in neighborhoods)
    max_single_demand = max((int(n.get("daily_orders", 0)) for n in neighborhoods), default=0)

    # Capacity constraints check
    if config.capacity_enabled and config.C_max is not None:
        total_capacity = config.K * config.C_max
        if total_capacity < total_demand:
            errors.append(ValidationErrorItem(
                field="C_max",
                value=config.C_max,
                error=f"Total capacity ({total_capacity}) across K={config.K} warehouses is less than total demand ({total_demand}). Infeasible.",
                code="TOTAL_CAPACITY_INSUFFICIENT"
            ))
        if config.C_max < max_single_demand:
            warnings.append(ValidationErrorItem(
                field="C_max",
                value=config.C_max,
                error=f"C_max ({config.C_max}) is less than highest single neighborhood demand ({max_single_demand}). Assignment may fail for this node.",
                code="CAPACITY_TOO_SMALL"
            ))

    # Large dataset warning for MILP
    if (config.capacity_enabled or config.radius_enabled) and len(neighborhoods) > 500:
        warnings.append(ValidationErrorItem(
            field="N",
            value=len(neighborhoods),
            error=f"Dataset size ({len(neighborhoods)}) with MILP constraints enabled may exceed optimal solver latency. Consider unconstrained mode.",
            code="LARGE_DATASET_PERFORMANCE_WARNING"
        ))

    is_valid = len(errors) == 0
    return is_valid, errors, warnings
