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
