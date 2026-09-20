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


ALLOWED_FUEL_TYPES = {"petrol", "diesel", "cng", "autogas", "electric"}


def validate_vehicle_row(row: Dict[str, Any], row_idx: Optional[int] = None) -> List[ValidationErrorItem]:
    """Validate a single owned-vehicle record (schema.md §2.3, Phase A #4)."""
    errors: List[ValidationErrorItem] = []

    vt = row.get("vehicle_type")
    if vt is None or str(vt).strip() == "" or (isinstance(vt, float) and np.isnan(vt)):
        errors.append(ValidationErrorItem(
            row=row_idx, field="vehicle_type", value=vt,
            error="vehicle_type is required, non-empty, and must be unique",
            code="NULL_OR_EMPTY"))

    cap = row.get("capacity")
    if cap is None or (isinstance(cap, float) and np.isnan(cap)):
        errors.append(ValidationErrorItem(
            row=row_idx, field="capacity", value=cap,
            error="capacity is required and cannot be null", code="NULL_VALUE"))
    else:
        try:
            cf = float(cap)
            if cf <= 0 or not cf.is_integer():
                errors.append(ValidationErrorItem(
                    row=row_idx, field="capacity", value=cap,
                    error="capacity must be a positive integer (> 0)", code="OUT_OF_RANGE"))
        except (ValueError, TypeError):
            errors.append(ValidationErrorItem(
                row=row_idx, field="capacity", value=cap,
                error=f"capacity '{cap}' is not a valid number", code="INVALID_TYPE"))

    cpk = row.get("cost_per_km")
    if cpk is None or (isinstance(cpk, float) and np.isnan(cpk)):
        errors.append(ValidationErrorItem(
            row=row_idx, field="cost_per_km", value=cpk,
            error="cost_per_km is required and cannot be null", code="NULL_VALUE"))
    else:
        try:
            cf = float(cpk)
            if cf < 0:
                errors.append(ValidationErrorItem(
                    row=row_idx, field="cost_per_km", value=cpk,
                    error="cost_per_km must be >= 0", code="OUT_OF_RANGE"))
        except (ValueError, TypeError):
            errors.append(ValidationErrorItem(
                row=row_idx, field="cost_per_km", value=cpk,
                error=f"cost_per_km '{cpk}' is not a valid number", code="INVALID_TYPE"))

    fuel = row.get("fuel_type", "petrol")
    if fuel is not None and str(fuel).strip() != "":
        if str(fuel).strip().lower() not in ALLOWED_FUEL_TYPES:
            errors.append(ValidationErrorItem(
                row=row_idx, field="fuel_type", value=fuel,
                error=f"fuel_type must be one of {sorted(ALLOWED_FUEL_TYPES)}",
                code="INVALID_FUEL_TYPE"))

    for field in ("avg_speed_kmph", "mileage_kmpl"):
        val = row.get(field)
        if val is None or (isinstance(val, float) and np.isnan(val)):
            continue  # optional
        try:
            f = float(val)
            if f <= 0:
                errors.append(ValidationErrorItem(
                    row=row_idx, field=field, value=val,
                    error=f"{field} must be > 0 when set", code="OUT_OF_RANGE"))
        except (ValueError, TypeError):
            errors.append(ValidationErrorItem(
                row=row_idx, field=field, value=val,
                error=f"{field} '{val}' is not a valid number", code="INVALID_TYPE"))

    return errors


def validate_vehicles(data: Union[List[Dict[str, Any]], pd.DataFrame]) -> Tuple[ValidationResult, List[Dict[str, Any]]]:
    """Validate an owned-fleet dataset. Returns (ValidationResult, clean records)."""
    if isinstance(data, pd.DataFrame):
        records = data.to_dict(orient="records")
    else:
        records = list(data)

    if len(records) == 0:
        empty_err = ValidationErrorItem(
            row=None, field="dataset", value=0,
            error="Vehicle dataset is empty. Add at least 1 vehicle or use the synthetic seeder.",
            code="EMPTY_DATASET")
        return ValidationResult(valid=False, errors=[empty_err], warnings=[], total_rows=0, valid_rows=0), []

    all_errors: List[ValidationErrorItem] = []
    seen: Dict[str, int] = {}
    clean: List[Dict[str, Any]] = []

    for idx, row in enumerate(records):
        row_num = idx + 1
        row_errors = validate_vehicle_row(row, row_idx=row_num)
        vt = row.get("vehicle_type")
        if vt is not None and str(vt).strip() != "":
            key = str(vt).strip().lower()
            if key in seen:
                row_errors.append(ValidationErrorItem(
                    row=row_num, field="vehicle_type", value=str(vt).strip(),
                    error=f"Duplicate vehicle_type '{str(vt).strip()}' (previously seen on row {seen[key]})",
                    code="DUPLICATE_ID"))
            else:
                seen[key] = row_num
        if row_errors:
            all_errors.extend(row_errors)
        else:
            fuel = row.get("fuel_type", "petrol")
            fuel = str(fuel).strip().lower() if fuel not in (None, "") else "petrol"
            clean.append({
                "vehicle_type": str(row["vehicle_type"]).strip(),
                "capacity": int(float(row["capacity"])),
                "cost_per_km": float(row["cost_per_km"]),
                "fuel_type": fuel,
                "avg_speed_kmph": float(row.get("avg_speed_kmph", 30.0) or 30.0),
                "mileage_kmpl": float(row["mileage_kmpl"]) if row.get("mileage_kmpl") not in (None, "") else None,
            })

    return ValidationResult(valid=len(all_errors) == 0, errors=all_errors,
                            warnings=[], total_rows=len(records), valid_rows=len(clean)), clean


def validate_warehouse_row(row: Dict[str, Any], row_idx: Optional[int] = None) -> List[ValidationErrorItem]:
    """Validate a single existing-warehouse record (schema.md §2.2, Phase A #4/#8)."""
    errors: List[ValidationErrorItem] = []

    wid = row.get("warehouse_id")
    if wid is None or str(wid).strip() == "" or (isinstance(wid, float) and np.isnan(wid)):
        errors.append(ValidationErrorItem(
            row=row_idx, field="warehouse_id", value=wid,
            error="warehouse_id is required, non-empty, and must be unique",
            code="NULL_OR_EMPTY"))

    for field, lo, hi in (("latitude", -90.0, 90.0), ("longitude", -180.0, 180.0)):
        val = row.get(field)
        if val is None or (isinstance(val, float) and np.isnan(val)):
            errors.append(ValidationErrorItem(
                row=row_idx, field=field, value=val,
                error=f"{field} is required and cannot be null", code="NULL_VALUE"))
        else:
            try:
                f = float(val)
                if not (lo <= f <= hi):
                    errors.append(ValidationErrorItem(
                        row=row_idx, field=field, value=val,
                        error=f"{field} must be in [{lo}, {hi}] WGS84 range", code="OUT_OF_RANGE"))
            except (ValueError, TypeError):
                errors.append(ValidationErrorItem(
                    row=row_idx, field=field, value=val,
                    error=f"{field} '{val}' is not a valid number", code="INVALID_TYPE"))

    cap = row.get("capacity")
    if cap is not None and not (isinstance(cap, float) and np.isnan(cap)) and str(cap).strip() != "":
        try:
            cf = float(cap)
            if cf <= 0 or not cf.is_integer():
                errors.append(ValidationErrorItem(
                    row=row_idx, field="capacity", value=cap,
                    error="capacity must be a positive integer (> 0) when set", code="OUT_OF_RANGE"))
        except (ValueError, TypeError):
            errors.append(ValidationErrorItem(
                row=row_idx, field="capacity", value=cap,
                error=f"capacity '{cap}' is not a valid number", code="INVALID_TYPE"))

    rad = row.get("radius_km")
    if rad is not None and not (isinstance(rad, float) and np.isnan(rad)) and str(rad).strip() != "":
        try:
            f = float(rad)
            if f <= 0:
                errors.append(ValidationErrorItem(
                    row=row_idx, field="radius_km", value=rad,
                    error="radius_km must be > 0 when set", code="OUT_OF_RANGE"))
        except (ValueError, TypeError):
            errors.append(ValidationErrorItem(
                row=row_idx, field="radius_km", value=rad,
                error=f"radius_km '{rad}' is not a valid number", code="INVALID_TYPE"))

    infra = row.get("infra_cost")
    if infra is not None and not (isinstance(infra, float) and np.isnan(infra)) and str(infra).strip() != "":
        try:
            f = float(infra)
            if f < 0:
                errors.append(ValidationErrorItem(
                    row=row_idx, field="infra_cost", value=infra,
                    error="infra_cost must be >= 0 when set", code="OUT_OF_RANGE"))
        except (ValueError, TypeError):
            errors.append(ValidationErrorItem(
                row=row_idx, field="infra_cost", value=infra,
                error=f"infra_cost '{infra}' is not a valid number", code="INVALID_TYPE"))

    return errors


def validate_warehouses(data: Union[List[Dict[str, Any]], pd.DataFrame]) -> Tuple[ValidationResult, List[Dict[str, Any]]]:
    """Validate an existing-warehouse dataset. Returns (ValidationResult, clean records)."""
    if isinstance(data, pd.DataFrame):
        records = data.to_dict(orient="records")
    else:
        records = list(data)

    if len(records) == 0:
        empty_err = ValidationErrorItem(
            row=None, field="dataset", value=0,
            error="Warehouse dataset is empty. Add at least 1 warehouse or use the synthetic seeder.",
            code="EMPTY_DATASET")
        return ValidationResult(valid=False, errors=[empty_err], warnings=[], total_rows=0, valid_rows=0), []

    all_errors: List[ValidationErrorItem] = []
    seen: Dict[str, int] = {}
    clean: List[Dict[str, Any]] = []

    def _opt_int(v: Any) -> Optional[int]:
        if v is None or (isinstance(v, float) and np.isnan(v)) or str(v).strip() == "":
            return None
        return int(float(v))

    def _opt_float(v: Any) -> Optional[float]:
        if v is None or (isinstance(v, float) and np.isnan(v)) or str(v).strip() == "":
            return None
        return float(v)

    for idx, row in enumerate(records):
        row_num = idx + 1
        row_errors = validate_warehouse_row(row, row_idx=row_num)
        wid = row.get("warehouse_id")
        if wid is not None and str(wid).strip() != "":
            key = str(wid).strip()
            if key in seen:
                row_errors.append(ValidationErrorItem(
                    row=row_num, field="warehouse_id", value=key,
                    error=f"Duplicate warehouse_id '{key}' (previously seen on row {seen[key]})",
                    code="DUPLICATE_ID"))
            else:
                seen[key] = row_num
        if row_errors:
            all_errors.extend(row_errors)
        else:
            clean.append({
                "warehouse_id": str(row["warehouse_id"]).strip(),
                "latitude": float(row["latitude"]),
                "longitude": float(row["longitude"]),
                "capacity": _opt_int(row.get("capacity")),
                "radius_km": _opt_float(row.get("radius_km")),
                "infra_cost": _opt_float(row.get("infra_cost", 0.0)) or 0.0,
                "assigned_orders": 0,
                "utilization_pct": 0.0,
            })

    return ValidationResult(valid=len(all_errors) == 0, errors=all_errors,
                            warnings=[], total_rows=len(records), valid_rows=len(clean)), clean


def validate_assignment_row(row: Dict[str, Any], row_idx: Optional[int] = None) -> List[ValidationErrorItem]:
    """Validate a single imported assignment record (neighborhood → warehouse)."""
    errors: List[ValidationErrorItem] = []

    for field in ("neighborhood_id", "warehouse_id"):
        val = row.get(field)
        if val is None or str(val).strip() == "" or (isinstance(val, float) and np.isnan(val)):
            errors.append(ValidationErrorItem(
                row=row_idx, field=field, value=val,
                error=f"{field} is required and non-empty",
                code="NULL_OR_EMPTY"))

    dist = row.get("distance_km")
    if dist is not None and not (isinstance(dist, float) and np.isnan(dist)) and str(dist).strip() != "":
        try:
            if float(dist) < 0:
                errors.append(ValidationErrorItem(
                    row=row_idx, field="distance_km", value=dist,
                    error="distance_km must be >= 0 when set", code="OUT_OF_RANGE"))
        except (ValueError, TypeError):
            errors.append(ValidationErrorItem(
                row=row_idx, field="distance_km", value=dist,
                error=f"distance_km '{dist}' is not a valid number", code="INVALID_TYPE"))

    return errors


def validate_assignments(
    data: Union[List[Dict[str, Any]], pd.DataFrame],
    known_neighborhoods: Optional[List[str]] = None,
    known_warehouses: Optional[List[str]] = None,
) -> Tuple[ValidationResult, List[Dict[str, Any]]]:
    """Validate an imported assignment dataset. Returns (ValidationResult, clean records).

    Unknown neighborhood/warehouse references are WARNINGS (rows still import;
    unresolvable rows are skipped when rendering). Duplicate neighborhood_ids
    are ERRORS (one node maps to exactly one warehouse).
    """
    if isinstance(data, pd.DataFrame):
        records = data.to_dict(orient="records")
    else:
        records = list(data)

    if len(records) == 0:
        empty_err = ValidationErrorItem(
            row=None, field="dataset", value=0,
            error="Assignment dataset is empty. Import at least 1 neighborhood → warehouse mapping.",
            code="EMPTY_DATASET")
        return ValidationResult(valid=False, errors=[empty_err], warnings=[], total_rows=0, valid_rows=0), []

    known_nb = {str(x).strip() for x in (known_neighborhoods or []) if str(x).strip() != ""}
    known_wh = {str(x).strip() for x in (known_warehouses or []) if str(x).strip() != ""}

    all_errors: List[ValidationErrorItem] = []
    warnings: List[ValidationErrorItem] = []
    seen: Dict[str, int] = {}
    clean: List[Dict[str, Any]] = []

    for idx, row in enumerate(records):
        row_num = idx + 1
        row_errors = validate_assignment_row(row, row_idx=row_num)
        nid = str(row.get("neighborhood_id", "")).strip() if row.get("neighborhood_id") is not None else ""
        if nid:
            if nid in seen:
                row_errors.append(ValidationErrorItem(
                    row=row_num, field="neighborhood_id", value=nid,
                    error=f"Duplicate neighborhood_id '{nid}' (previously seen on row {seen[nid]}); one node maps to one warehouse",
                    code="DUPLICATE_ID"))
            else:
                seen[nid] = row_num
        if row_errors:
            all_errors.extend(row_errors)
            continue
        wid = str(row.get("warehouse_id")).strip()
        if known_nb and nid not in known_nb:
            warnings.append(ValidationErrorItem(
                row=row_num, field="neighborhood_id", value=nid,
                error=f"neighborhood_id '{nid}' is not in the loaded demand data; row will be skipped on the map",
                code="UNKNOWN_REFERENCE"))
        if known_wh and wid not in known_wh:
            warnings.append(ValidationErrorItem(
                row=row_num, field="warehouse_id", value=wid,
                error=f"warehouse_id '{wid}' is not in the loaded warehouses; row will be skipped on the map",
                code="UNKNOWN_REFERENCE"))
        dist = row.get("distance_km")
        clean.append({
            "neighborhood_id": nid,
            "warehouse_id": wid,
            "distance_km": float(dist) if dist not in (None, "") else None,
        })

    return ValidationResult(valid=len(all_errors) == 0, errors=all_errors,
                            warnings=warnings, total_rows=len(records),
                            valid_rows=len(clean)), clean


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
