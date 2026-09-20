"""
GridPoint Data Ingestion Engine
Handles CSV/JSON parsing, schema alias detection, and data conversion.
"""
import io
import json
import csv
from typing import List, Dict, Any, Tuple, Optional, Union
import pandas as pd
from .schema import ValidationErrorItem, ValidationResult
from .validation import validate_neighborhoods, validate_vehicles, validate_warehouses

# Canonical aliases map
COLUMN_ALIASES: Dict[str, List[str]] = {
    "neighborhood_id": ["neighborhood_id", "id", "nid", "node_id", "neighborhood", "location_id", "code"],
    "name": ["name", "neighborhood_name", "area", "label", "title", "neighborhood"],
    "latitude": ["latitude", "lat", "y", "wgs84_lat", "lat_deg"],
    "longitude": ["longitude", "longitude_deg", "lon", "lng", "long", "x", "wgs84_lon"],
    "daily_orders": ["daily_orders", "orders", "demand", "daily_demand", "order_count", "weight", "volume", "w_i"],
    "zone": ["zone", "region", "cluster", "district", "sector"]
}


def normalize_column_name(col_name: str) -> Optional[str]:
    """Map any header alias to canonical column name."""
    cleaned = str(col_name).strip().lower().replace(" ", "_").replace("-", "_")
    for canonical, aliases in COLUMN_ALIASES.items():
        if cleaned in aliases:
            return canonical
    return None


def map_dataframe_columns(df: pd.DataFrame) -> Tuple[pd.DataFrame, Dict[str, str], List[str]]:
    """
    Renames DataFrame columns based on known aliases.
    Returns (mapped_df, mappings_dict, missing_required_columns).
    """
    mapped_cols = {}
    used_canonicals = set()

    for col in df.columns:
        canonical = normalize_column_name(col)
        if canonical and canonical not in used_canonicals:
            mapped_cols[col] = canonical
            used_canonicals.add(canonical)

    df_renamed = df.rename(columns=mapped_cols)

    required_cols = ["neighborhood_id", "latitude", "longitude", "daily_orders"]
    missing_cols = [c for c in required_cols if c not in df_renamed.columns]

    return df_renamed, mapped_cols, missing_cols


def parse_csv_content(content_str: str) -> Tuple[ValidationResult, List[Dict[str, Any]]]:
    """Parse CSV text with delimiter sniffing and column mapping."""
    if not content_str or not content_str.strip():
        empty_err = ValidationErrorItem(
            field="file",
            value="",
            error="Uploaded CSV file is empty.",
            code="EMPTY_FILE"
        )
        return ValidationResult(valid=False, errors=[empty_err]), []

    try:
        # Detect delimiter (comma, semicolon, tab)
        sample = content_str[:2048]
        try:
            dialect = csv.Sniffer().sniff(sample, delimiters=",\t;|")
            delimiter = dialect.delimiter
        except Exception:
            delimiter = ","

        df = pd.read_csv(io.StringIO(content_str), sep=delimiter, skipinitialspace=True)
    except Exception as e:
        parse_err = ValidationErrorItem(
            field="file",
            value="",
            error=f"Failed to parse CSV: {str(e)}",
            code="MALFORMED_CSV"
        )
        return ValidationResult(valid=False, errors=[parse_err]), []

    df_renamed, _, missing = map_dataframe_columns(df)

    if missing:
        missing_err = ValidationErrorItem(
            field="headers",
            value=list(df.columns),
            error=f"CSV is missing required columns: {', '.join(missing)}. Recognized headers: {list(df.columns)}",
            code="MISSING_REQUIRED_COLUMNS"
        )
        return ValidationResult(valid=False, errors=[missing_err], total_rows=len(df)), []

    return validate_neighborhoods(df_renamed)


def parse_json_content(content_str: str) -> Tuple[ValidationResult, List[Dict[str, Any]]]:
    """Parse JSON string (either array of objects or wrapped in {'neighborhoods': [...]})."""
    if not content_str or not content_str.strip():
        empty_err = ValidationErrorItem(
            field="file",
            value="",
            error="Uploaded JSON file is empty.",
            code="EMPTY_FILE"
        )
        return ValidationResult(valid=False, errors=[empty_err]), []

    try:
        data = json.loads(content_str)
    except Exception as e:
        parse_err = ValidationErrorItem(
            field="file",
            value="",
            error=f"Failed to parse JSON: {str(e)}",
            code="MALFORMED_JSON"
        )
        return ValidationResult(valid=False, errors=[parse_err]), []

    # Unwrap if wrapped
    if isinstance(data, dict):
        if "neighborhoods" in data and isinstance(data["neighborhoods"], list):
            data = data["neighborhoods"]
        elif "data" in data and isinstance(data["data"], list):
            data = data["data"]
        else:
            invalid_shape_err = ValidationErrorItem(
                field="format",
                value=list(data.keys()),
                error="Expected a JSON array of neighborhood objects or an object with a 'neighborhoods' key.",
                code="INVALID_JSON_STRUCTURE"
            )
            return ValidationResult(valid=False, errors=[invalid_shape_err]), []

    if not isinstance(data, list):
        invalid_type_err = ValidationErrorItem(
            field="format",
            value=type(data).__name__,
            error="Expected a JSON list/array of neighborhood objects.",
            code="INVALID_JSON_STRUCTURE"
        )
        return ValidationResult(valid=False, errors=[invalid_type_err]), []

    # Normalize keys in dicts
    normalized_list = []
    for item in data:
        if not isinstance(item, dict):
            continue
        normalized_row = {}
        for k, v in item.items():
            canon = normalize_column_name(k)
            if canon:
                normalized_row[canon] = v
            else:
                normalized_row[k] = v
        normalized_list.append(normalized_row)

    return validate_neighborhoods(normalized_list)


# --- Phase A: vehicle + warehouse alias maps (onboarding trio) ---
VEHICLE_COLUMN_ALIASES: Dict[str, List[str]] = {
    "vehicle_type": ["vehicle_type", "vehicle", "type", "name", "fleet_type"],
    "capacity": ["capacity", "cap", "orders_per_trip", "load_capacity"],
    "cost_per_km": ["cost_per_km", "cost", "cost_km", "rate_per_km", "operating_cost"],
    "fuel_type": ["fuel_type", "fuel", "fueltype"],
    "avg_speed_kmph": ["avg_speed_kmph", "avg_speed", "speed", "speed_kmph"],
    "mileage_kmpl": ["mileage_kmpl", "mileage", "kmpl", "fuel_economy"],
}

WAREHOUSE_COLUMN_ALIASES: Dict[str, List[str]] = {
    "warehouse_id": ["warehouse_id", "id", "wid", "warehouse", "site_id"],
    "latitude": ["latitude", "lat", "y", "wgs84_lat", "lat_deg"],
    "longitude": ["longitude", "longitude_deg", "lon", "lng", "long", "x", "wgs84_lon"],
    "capacity": ["capacity", "cap", "c_max", "max_orders"],
    "radius_km": ["radius_km", "radius", "r_max", "r_max_km", "service_radius"],
    "infra_cost": ["infra_cost", "infra", "fixed_cost", "setup_cost"],
}

VEHICLE_REQUIRED = ["vehicle_type", "capacity", "cost_per_km"]
WAREHOUSE_REQUIRED = ["warehouse_id", "latitude", "longitude"]


def _normalize_with_aliases(item: Dict[str, Any], aliases: Dict[str, List[str]]) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    for k, v in item.items():
        cleaned = str(k).strip().lower().replace(" ", "_").replace("-", "_")
        canon = None
        for c, names in aliases.items():
            if cleaned in names:
                canon = c
                break
        out[canon or k] = v
    return out


def _map_df_with_aliases(df: pd.DataFrame, aliases: Dict[str, List[str]],
                          required: List[str]) -> Tuple[pd.DataFrame, Dict[str, str], List[str]]:
    mapped: Dict[str, str] = {}
    used = set()
    for col in df.columns:
        cleaned = str(col).strip().lower().replace(" ", "_").replace("-", "_")
        for canon, names in aliases.items():
            if cleaned in names and canon not in used:
                mapped[col] = canon
                used.add(canon)
                break
    renamed = df.rename(columns=mapped)
    missing = [c for c in required if c not in renamed.columns]
    return renamed, mapped, missing


def parse_vehicles_csv(content_str: str) -> Tuple[ValidationResult, List[Dict[str, Any]]]:
    """Parse owned-fleet CSV with alias mapping (Phase A #4)."""
    if not content_str or not content_str.strip():
        return ValidationResult(valid=False, errors=[ValidationErrorItem(
            field="file", value="", error="Uploaded CSV file is empty.", code="EMPTY_FILE")]), []
    try:
        sample = content_str[:2048]
        try:
            dialect = csv.Sniffer().sniff(sample, delimiters=",\t;|")
            delimiter = dialect.delimiter
        except Exception:
            delimiter = ","
        df = pd.read_csv(io.StringIO(content_str), sep=delimiter, skipinitialspace=True)
    except Exception as e:
        return ValidationResult(valid=False, errors=[ValidationErrorItem(
            field="file", value="", error=f"Failed to parse CSV: {e}", code="MALFORMED_CSV")]), []
    renamed, _, missing = _map_df_with_aliases(df, VEHICLE_COLUMN_ALIASES, VEHICLE_REQUIRED)
    if missing:
        return ValidationResult(valid=False, errors=[ValidationErrorItem(
            field="headers", value=list(df.columns),
            error=f"CSV is missing required vehicle columns: {', '.join(missing)}.",
            code="MISSING_REQUIRED_COLUMNS")], total_rows=len(df)), []
    return validate_vehicles(renamed)


def parse_vehicles_json(content_str: str) -> Tuple[ValidationResult, List[Dict[str, Any]]]:
    """Parse owned-fleet JSON (array or {vehicles:[...]} wrapper)."""
    if not content_str or not content_str.strip():
        return ValidationResult(valid=False, errors=[ValidationErrorItem(
            field="file", value="", error="Uploaded JSON file is empty.", code="EMPTY_FILE")]), []
    try:
        data = json.loads(content_str)
    except Exception as e:
        return ValidationResult(valid=False, errors=[ValidationErrorItem(
            field="file", value="", error=f"Failed to parse JSON: {e}", code="MALFORMED_JSON")]), []
    if isinstance(data, dict):
        for key in ("vehicles", "fleet", "vehicle_fleet"):
            if isinstance(data.get(key), list):
                data = data[key]
                break
        else:
            return ValidationResult(valid=False, errors=[ValidationErrorItem(
                field="format", value=list(data.keys()),
                error="Expected a JSON array of vehicle objects or an object with a 'vehicles' key.",
                code="INVALID_JSON_STRUCTURE")]), []
    if not isinstance(data, list):
        return ValidationResult(valid=False, errors=[ValidationErrorItem(
            field="format", value=type(data).__name__,
            error="Expected a JSON list/array of vehicle objects.", code="INVALID_JSON_STRUCTURE")]), []
    rows = [_normalize_with_aliases(i, VEHICLE_COLUMN_ALIASES) for i in data if isinstance(i, dict)]
    return validate_vehicles(rows)


def parse_warehouses_csv(content_str: str) -> Tuple[ValidationResult, List[Dict[str, Any]]]:
    """Parse existing-warehouse CSV with alias mapping (Phase A #4/#8)."""
    if not content_str or not content_str.strip():
        return ValidationResult(valid=False, errors=[ValidationErrorItem(
            field="file", value="", error="Uploaded CSV file is empty.", code="EMPTY_FILE")]), []
    try:
        sample = content_str[:2048]
        try:
            dialect = csv.Sniffer().sniff(sample, delimiters=",\t;|")
            delimiter = dialect.delimiter
        except Exception:
            delimiter = ","
        df = pd.read_csv(io.StringIO(content_str), sep=delimiter, skipinitialspace=True)
    except Exception as e:
        return ValidationResult(valid=False, errors=[ValidationErrorItem(
            field="file", value="", error=f"Failed to parse CSV: {e}", code="MALFORMED_CSV")]), []
    renamed, _, missing = _map_df_with_aliases(df, WAREHOUSE_COLUMN_ALIASES, WAREHOUSE_REQUIRED)
    if missing:
        return ValidationResult(valid=False, errors=[ValidationErrorItem(
            field="headers", value=list(df.columns),
            error=f"CSV is missing required warehouse columns: {', '.join(missing)}.",
            code="MISSING_REQUIRED_COLUMNS")], total_rows=len(df)), []
    return validate_warehouses(renamed)


def parse_warehouses_json(content_str: str) -> Tuple[ValidationResult, List[Dict[str, Any]]]:
    """Parse existing-warehouse JSON (array or {warehouses|custom_baseline_warehouses:[...]})."""
    if not content_str or not content_str.strip():
        return ValidationResult(valid=False, errors=[ValidationErrorItem(
            field="file", value="", error="Uploaded JSON file is empty.", code="EMPTY_FILE")]), []
    try:
        data = json.loads(content_str)
    except Exception as e:
        return ValidationResult(valid=False, errors=[ValidationErrorItem(
            field="file", value="", error=f"Failed to parse JSON: {e}", code="MALFORMED_JSON")]), []
    if isinstance(data, dict):
        for key in ("warehouses", "custom_baseline_warehouses", "existing_warehouses"):
            if isinstance(data.get(key), list):
                data = data[key]
                break
        else:
            return ValidationResult(valid=False, errors=[ValidationErrorItem(
                field="format", value=list(data.keys()),
                error="Expected a JSON array of warehouse objects or an object with a 'warehouses' key.",
                code="INVALID_JSON_STRUCTURE")]), []
    if not isinstance(data, list):
        return ValidationResult(valid=False, errors=[ValidationErrorItem(
            field="format", value=type(data).__name__,
            error="Expected a JSON list/array of warehouse objects.", code="INVALID_JSON_STRUCTURE")]), []
    rows = [_normalize_with_aliases(i, WAREHOUSE_COLUMN_ALIASES) for i in data if isinstance(i, dict)]
    return validate_warehouses(rows)


def export_vehicles_to_csv(vehicles: List[Dict[str, Any]]) -> str:
    """Export owned-fleet records to canonical CSV."""
    df = pd.DataFrame(vehicles)
    columns = ["vehicle_type", "capacity", "cost_per_km", "fuel_type", "avg_speed_kmph", "mileage_kmpl"]
    for col in columns:
        if col not in df.columns:
            df[col] = ""
    return df[columns].to_csv(index=False)


def export_warehouses_to_csv(warehouses: List[Dict[str, Any]]) -> str:
    """Export existing-warehouse records to canonical CSV (D-baseline / E keep set)."""
    df = pd.DataFrame(warehouses)
    columns = ["warehouse_id", "latitude", "longitude", "capacity", "radius_km", "infra_cost"]
    for col in columns:
        if col not in df.columns:
            df[col] = ""
    return df[columns].to_csv(index=False)


def compute_fleet_summary(vehicles: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Fleet rollup for the Overview/checklist (count + mix)."""
    mix: Dict[str, int] = {}
    for v in vehicles:
        key = str(v.get("vehicle_type", "unknown"))
        mix[key] = mix.get(key, 0) + 1
    caps = [int(v.get("capacity", 0) or 0) for v in vehicles]
    return {"count": len(vehicles), "mix": mix,
            "total_capacity": sum(caps), "avg_capacity": round(sum(caps) / len(caps), 2) if caps else 0.0}


def compute_warehouse_summary(warehouses: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Existing-site rollup (count + infra total)."""
    infra = [float(w.get("infra_cost", 0.0) or 0.0) for w in warehouses]
    return {"count": len(warehouses), "total_infra_cost": round(sum(infra), 2),
            "ids": [str(w.get("warehouse_id")) for w in warehouses]}


def export_to_csv(neighborhoods: List[Dict[str, Any]]) -> str:
    """Export clean neighborhood records to canonical CSV format."""
    df = pd.DataFrame(neighborhoods)
    columns = ["neighborhood_id", "name", "latitude", "longitude", "daily_orders"]
    if "zone" in df.columns and df["zone"].notna().any():
        columns.append("zone")
    for col in columns:
        if col not in df.columns:
            df[col] = ""
    return df[columns].to_csv(index=False)


def export_to_json(neighborhoods: List[Dict[str, Any]], indent: int = 2) -> str:
    """Export clean neighborhood records to formatted JSON."""
    return json.dumps(neighborhoods, indent=indent)


def compute_dataset_summary(neighborhoods: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Calculate geographic and demand summary statistics for the dataset."""
    if not neighborhoods:
        return {
            "count": 0,
            "total_orders": 0,
            "avg_orders": 0.0,
            "min_orders": 0,
            "max_orders": 0,
            "center": {"lat": 0.0, "lon": 0.0},
            "bounds": {"min_lat": 0.0, "max_lat": 0.0, "min_lon": 0.0, "max_lon": 0.0}
        }

    lats = [float(n["latitude"]) for n in neighborhoods]
    lons = [float(n["longitude"]) for n in neighborhoods]
    orders = [int(n["daily_orders"]) for n in neighborhoods]

    total_orders = sum(orders)
    return {
        "count": len(neighborhoods),
        "total_orders": total_orders,
        "avg_orders": round(total_orders / len(neighborhoods), 2),
        "min_orders": min(orders),
        "max_orders": max(orders),
        "center": {
            "lat": round(sum(lats) / len(lats), 6),
            "lon": round(sum(lons) / len(lons), 6)
        },
        "bounds": {
            "min_lat": round(min(lats), 6),
            "max_lat": round(max(lats), 6),
            "min_lon": round(min(lons), 6),
            "max_lon": round(max(lons), 6)
        }
    }
