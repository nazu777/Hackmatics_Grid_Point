"""
GridPoint Spatial Mapping Module (Phase 2)
Provides utilities for bounding box calculation, auto-viewport centering,
demand bubble scaling, color palettes, and layer definitions.
"""
from typing import List, Dict, Any, Tuple, Optional
import math


def compute_map_bounds(neighborhoods: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Computes geographic bounds and optimal center coordinates for a dataset of neighborhoods.
    Handles single-point edge cases and empty datasets gracefully.
    """
    if not neighborhoods:
        return {
            "center": {"lat": 17.385044, "lon": 78.486671},
            "bounds": {"min_lat": 17.3, "max_lat": 17.5, "min_lon": 78.3, "max_lon": 78.6},
            "suggested_zoom": 11,
            "span_km": 0.0
        }

    lats = [float(n["latitude"]) for n in neighborhoods if n.get("latitude") is not None]
    lons = [float(n["longitude"]) for n in neighborhoods if n.get("longitude") is not None]

    if not lats or not lons:
        return {
            "center": {"lat": 17.385044, "lon": 78.486671},
            "bounds": {"min_lat": 17.3, "max_lat": 17.5, "min_lon": 78.3, "max_lon": 78.6},
            "suggested_zoom": 11,
            "span_km": 0.0
        }

    min_lat, max_lat = min(lats), max(lats)
    min_lon, max_lon = min(lons), max(lons)

    # Handle single point or very narrow span by adding a buffer
    if abs(max_lat - min_lat) < 1e-4:
        min_lat -= 0.02
        max_lat += 0.02
    if abs(max_lon - min_lon) < 1e-4:
        min_lon -= 0.02
        max_lon += 0.02

    center_lat = (min_lat + max_lat) / 2.0
    center_lon = (min_lon + max_lon) / 2.0

    # Approximate span in km (1 deg lat ~ 111km)
    lat_diff_km = (max_lat - min_lat) * 111.0
    lon_diff_km = (max_lon - min_lon) * 111.0 * math.cos(math.radians(center_lat))
    span_km = max(lat_diff_km, abs(lon_diff_km))

    # Calculate suggested zoom level
    if span_km <= 5:
        suggested_zoom = 13
    elif span_km <= 15:
        suggested_zoom = 12
    elif span_km <= 35:
        suggested_zoom = 11
    elif span_km <= 80:
        suggested_zoom = 10
    elif span_km <= 200:
        suggested_zoom = 8
    else:
        suggested_zoom = 6

    return {
        "center": {"lat": round(center_lat, 6), "lon": round(center_lon, 6)},
        "bounds": {
            "min_lat": round(min_lat, 6),
            "max_lat": round(max_lat, 6),
            "min_lon": round(min_lon, 6),
            "max_lon": round(max_lon, 6)
        },
        "suggested_zoom": suggested_zoom,
        "span_km": round(span_km, 2)
    }


def compute_bubble_style(
    orders: int,
    min_orders: int,
    max_orders: int,
    min_radius: float = 6.0,
    max_radius: float = 24.0
) -> Dict[str, Any]:
    """
    Computes visual radius and color for a demand bubble based on daily orders.
    Uses square-root scaling for radius to ensure perceived bubble area is proportional to demand.
    """
    if max_orders <= min_orders:
        ratio = 0.5
    else:
        ratio = max(0.0, min(1.0, (orders - min_orders) / (max_orders - min_orders)))

    # Area-proportional scaling: radius = sqrt(ratio) * range
    scaled_radius = min_radius + (max_radius - min_radius) * math.sqrt(ratio)

    # Color palette gradient: Emerald (low) -> Amber (mid) -> Rose/Coral (high)
    if ratio < 0.33:
        # Low demand: Teal / Emerald
        rgb = [16, 185, 129] # #10b981
        hex_color = "#10b981"
        category = "Low"
    elif ratio < 0.67:
        # Medium demand: Amber / Golden
        rgb = [245, 158, 11] # #f59e0b
        hex_color = "#f59e0b"
        category = "Medium"
    else:
        # High demand: Rose / Crimson
        rgb = [239, 68, 68] # #ef4444
        hex_color = "#ef4444"
        category = "High"

    return {
        "radius_px": round(scaled_radius, 1),
        "fill_color": rgb,
        "hex_color": hex_color,
        "category": category,
        "demand_ratio": round(ratio, 3)
    }


def prepare_map_layer_data(neighborhoods: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Augments neighborhood records with visual styling metadata for mapping backends.
    """
    if not neighborhoods:
        return {"nodes": [], "bounds_info": compute_map_bounds([])}

    orders_list = [int(n.get("daily_orders", 0)) for n in neighborhoods]
    min_orders = min(orders_list) if orders_list else 0
    max_orders = max(orders_list) if orders_list else 1

    styled_nodes = []
    for n in neighborhoods:
        orders = int(n.get("daily_orders", 0))
        style = compute_bubble_style(orders, min_orders, max_orders)
        styled_nodes.append({
            **n,
            "visual_radius": style["radius_px"],
            "color_rgb": style["fill_color"],
            "color_hex": style["hex_color"],
            "demand_category": style["category"],
            "demand_ratio": style["demand_ratio"]
        })

    bounds_info = compute_map_bounds(neighborhoods)

    return {
        "nodes": styled_nodes,
        "bounds_info": bounds_info,
        "min_orders": min_orders,
        "max_orders": max_orders,
        "total_nodes": len(neighborhoods)
    }

# --- Phase 4: assignment overlay helpers (warehouses, lines, GeoJSON) ---
PALETTE = [
    "#10b981", "#3b82f6", "#f59e0b", "#ef4444", "#8b5cf6",
    "#06b6d4", "#f97316", "#84cc16", "#ec4899", "#6366f1",
]


def warehouse_color(warehouse_id: str) -> str:
    """Deterministic color per warehouse: W1..WK ΓåÆ palette."""
    try:
        idx = int("".join(c for c in warehouse_id if c.isdigit()) or "1") - 1
    except ValueError:
        idx = 0
    return PALETTE[idx % len(PALETTE)]


def fit_bounds(neighborhoods: List[Dict[str, Any]],
               warehouses: List[Dict[str, Any]] | None = None) -> Dict[str, float]:
    """Auto-fit bounding box over demand + warehouses; handles single-point."""
    lats = [float(n["latitude"]) for n in neighborhoods]
    lons = [float(n["longitude"]) for n in neighborhoods]
    if warehouses:
        lats += [float(w["latitude"]) for w in warehouses]
        lons += [float(w["longitude"]) for w in warehouses]
    if not lats:
        return {"min_lat": 0.0, "max_lat": 0.0, "min_lon": 0.0, "max_lon": 0.0,
                "center_lat": 0.0, "center_lon": 0.0}
    min_lat, max_lat = min(lats), max(lats)
    min_lon, max_lon = min(lons), max(lons)
    if min_lat == max_lat:
        min_lat -= 0.05
        max_lat += 0.05
    if min_lon == max_lon:
        min_lon -= 0.05
        max_lon += 0.05
    return {"min_lat": min_lat, "max_lat": max_lat, "min_lon": min_lon, "max_lon": max_lon,
            "center_lat": (min_lat + max_lat) / 2.0, "center_lon": (min_lon + max_lon) / 2.0}


def bubble_radius(daily_orders: int, min_r: float = 4.0, max_r: float = 22.0,
                  max_orders: int | None = None) -> float:
    """Bubble size Γê¥ sqrt(orders) so area scales linearly with demand."""
    import math
    if max_orders is None or max_orders <= 0:
        max_orders = max(1, int(daily_orders))
    frac = math.sqrt(max(0, int(daily_orders)) / max(1, max_orders))
    return round(min_r + frac * (max_r - min_r), 1)


def assignment_lines(
    neighborhoods: List[Dict[str, Any]],
    warehouses: List[Dict[str, Any]],
    assignments: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """Polylines neighborhoodΓåÆassigned warehouse; map lines match assignment table."""
    wh_by_id = {str(w["warehouse_id"]): w for w in warehouses}
    nb_by_id = {str(n["neighborhood_id"]): n for n in neighborhoods}
    lines: List[Dict[str, Any]] = []
    for a in assignments:
        nb = nb_by_id.get(str(a["neighborhood_id"]))
        wh = wh_by_id.get(str(a["warehouse_id"]))
        if not nb or not wh:
            continue
        lines.append({
            "neighborhood_id": str(a["neighborhood_id"]),
            "warehouse_id": str(a["warehouse_id"]),
            "from": [float(nb["latitude"]), float(nb["longitude"])],
            "to": [float(wh["latitude"]), float(wh["longitude"])],
            "distance_km": float(a.get("distance_km", 0.0)),
            "color": warehouse_color(str(a["warehouse_id"])),
            "is_feasible": bool(a.get("is_feasible", True)),
        })
    return lines


def map_points(neighborhoods: List[Dict[str, Any]],
               assignments: List[Dict[str, Any]] | None = None) -> List[Dict[str, Any]]:
    """Demand nodes with cluster color + bubble radius for Leaflet/st.map."""
    max_o = max([int(n["daily_orders"]) for n in neighborhoods] + [1])
    asg_by_nb = {str(a["neighborhood_id"]): a for a in (assignments or [])}
    pts: List[Dict[str, Any]] = []
    for n in neighborhoods:
        a = asg_by_nb.get(str(n["neighborhood_id"]))
        color = warehouse_color(str(a["warehouse_id"])) if a else "#64748b"
        pts.append({
            "neighborhood_id": str(n["neighborhood_id"]),
            "name": n.get("name") or str(n["neighborhood_id"]),
            "latitude": float(n["latitude"]),
            "longitude": float(n["longitude"]),
            "daily_orders": int(n["daily_orders"]),
            "radius": bubble_radius(int(n["daily_orders"]), max_orders=max_o),
            "color": color,
            "warehouse_id": str(a["warehouse_id"]) if a else None,
        })
    return pts


def to_geojson(neighborhoods: List[Dict[str, Any]],
               warehouses: List[Dict[str, Any]],
               assignments: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Map snapshot export: demand points + warehouses + assignment lines."""
    features: List[Dict[str, Any]] = []
    for p in map_points(neighborhoods, assignments):
        features.append({"type": "Feature",
                         "properties": {"kind": "neighborhood", **{k: v for k, v in p.items()
                                                                   if k not in ("latitude", "longitude")}},
                         "geometry": {"type": "Point",
                                      "coordinates": [p["longitude"], p["latitude"]]}})
    for w in warehouses:
        features.append({"type": "Feature",
                         "properties": {"kind": "warehouse",
                                        "warehouse_id": str(w["warehouse_id"]),
                                        "color": warehouse_color(str(w["warehouse_id"]))},
                         "geometry": {"type": "Point",
                                      "coordinates": [float(w["longitude"]), float(w["latitude"])]}})
    for line in assignment_lines(neighborhoods, warehouses, assignments):
        (la1, lo1), (la2, lo2) = line["from"], line["to"]
        features.append({"type": "Feature",
                         "properties": {"kind": "assignment", **{k: v for k, v in line.items()
                                                                 if k not in ("from", "to")}},
                         "geometry": {"type": "LineString",
                                      "coordinates": [[lo1, la1], [lo2, la2]]}})
    return {"type": "FeatureCollection", "features": features}
