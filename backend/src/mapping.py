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


DEFAULT_ZONE_COLORS = {
    "Residential": "#10b981",
    "Commercial": "#3b82f6",
    "Industrial": "#f59e0b",
    "Mixed": "#8b5cf6",
}

ZONE_FALLBACK_PALETTE = [
    "#06b6d4", "#f97316", "#84cc16", "#ec4899", "#6366f1",
    "#14b8a6", "#eab308", "#ef4444", "#a855f7", "#0ea5e9",
]


def normalize_zone(zone: Any) -> str:
    """Normalize free-form zone/category, defaulting to 'Unzoned'."""
    z = str(zone).strip() if zone is not None else ""
    return z or "Unzoned"


def zone_color(zone: Any, custom: Dict[str, str] | None = None) -> str:
    """Deterministic zone color: custom map -> defaults -> hash fallback (mirrors frontend)."""
    key = normalize_zone(zone)
    if custom and key in custom:
        return custom[key]
    if key in DEFAULT_ZONE_COLORS:
        return DEFAULT_ZONE_COLORS[key]
    h = 0
    for ch in key.lower():
        h = (h * 31 + ord(ch)) & 0xFFFFFFFF
    return ZONE_FALLBACK_PALETTE[h % len(ZONE_FALLBACK_PALETTE)]


def distinct_zones(neighborhoods: List[Dict[str, Any]]) -> List[str]:
    """Sorted distinct zone names in a dataset."""
    return sorted({normalize_zone(n.get("zone")) for n in neighborhoods})


def map_points(neighborhoods: List[Dict[str, Any]],
               assignments: List[Dict[str, Any]] | None = None,
               zone_colors: Dict[str, str] | None = None) -> List[Dict[str, Any]]:
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
            "zone": normalize_zone(n.get("zone")),
            "zone_color": zone_color(n.get("zone"), zone_colors),
            "radius": bubble_radius(int(n["daily_orders"]), max_orders=max_o),
            "color": color,
            "warehouse_id": str(a["warehouse_id"]) if a else None,
        })
    return pts


def proximity_color(t: float) -> str:
    """Coverage heatmap color: green (near, t=0) → amber → red (far, t=1)."""
    t = max(0.0, min(1.0, float(t)))
    if t < 0.5:
        # green (#22c55e) → amber (#f59e0b)
        f = t / 0.5
        r = round(0x22 + (0xF5 - 0x22) * f)
        g = round(0xC5 + (0x9E - 0xC5) * f)
        b = round(0x5E + (0x0B - 0x5E) * f)
    else:
        # amber (#f59e0b) → red (#ef4444)
        f = (t - 0.5) / 0.5
        r = round(0xF5 + (0xEF - 0xF5) * f)
        g = round(0x9E + (0x44 - 0x9E) * f)
        b = round(0x0B + (0x44 - 0x0B) * f)
    return f"#{r:02x}{g:02x}{b:02x}"


def warehouse_focus_summary(
    warehouse_id: str,
    neighborhoods: List[Dict[str, Any]],
    warehouses: List[Dict[str, Any]],
    assignments: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """Phase B (#1): isolated zone payload for a clicked warehouse.

    Returns center, derived load (assigned_orders = Σ daily_orders),
    utilization, capacity/radius/infra, plus the full assigned-node list
    with per-node daily_orders + distance. Unknown ids yield
    {"found": False}.
    """
    wid = str(warehouse_id)
    wh = next((w for w in warehouses if str(w.get("warehouse_id")) == wid), None)
    if wh is None:
        return {"found": False, "warehouse_id": wid}
    nb_by_id = {str(n.get("neighborhood_id")): n for n in neighborhoods}
    members: List[Dict[str, Any]] = []
    total_orders = 0
    dists: List[float] = []
    for a in assignments:
        if str(a.get("warehouse_id")) != wid:
            continue
        nid = str(a.get("neighborhood_id"))
        nb = nb_by_id.get(nid, {})
        orders = int(nb.get("daily_orders", 0) or 0)
        d = float(a.get("distance_km", 0.0) or 0.0)
        total_orders += orders
        dists.append(d)
        members.append({
            "neighborhood_id": nid,
            "name": nb.get("name") or nid,
            "latitude": nb.get("latitude"),
            "longitude": nb.get("longitude"),
            "daily_orders": orders,
            "zone": normalize_zone(nb.get("zone")),
            "distance_km": round(d, 2),
            "within_radius": bool(a.get("within_radius", True)),
            "is_feasible": bool(a.get("is_feasible", True)),
        })
    members.sort(key=lambda m: m["distance_km"])
    cap = wh.get("capacity")
    util = None
    try:
        if cap is not None and float(cap) > 0:
            util = round(total_orders / float(cap) * 100.0, 1)
    except (TypeError, ValueError):
        util = None
    return {
        "found": True,
        "warehouse_id": wid,
        "center": {"lat": float(wh.get("latitude")), "lon": float(wh.get("longitude"))},
        "assigned_orders": total_orders,
        "neighborhood_count": len(members),
        "utilization_pct": util if util is not None else wh.get("utilization_pct"),
        "capacity": cap,
        "radius_km": wh.get("radius_km"),
        "infra_cost": wh.get("infra_cost"),
        "color": warehouse_color(wid),
        "avg_distance_km": round(sum(dists) / len(dists), 2) if dists else 0.0,
        "max_distance_km": round(max(dists), 2) if dists else 0.0,
        "members": members,
    }


def coverage_heatmap(
    neighborhoods: List[Dict[str, Any]],
    assignments: List[Dict[str, Any]],
    grid_n: int = 24,
    top_k: int = 0,
) -> Dict[str, Any]:
    """Phase B (#2): green (near warehouse) → red (far) proximity gradient.

    Recomputed from ACTIVE assignment distances: each node contributes its
    assigned distance_km; grid cells interpolate nearby nodes (inverse-distance
    weighting) and carry a normalized t + hex color. Blended UNDER
    bubbles/routes on the client. When top_k > 0 only the top_k farthest
    nodes are also returned as a hotspot list.
    """
    nodes = [n for n in neighborhoods
             if n.get("latitude") is not None and n.get("longitude") is not None]
    if not nodes:
        return {"cells": [], "min_km": 0.0, "max_km": 0.0, "hotspots": []}
    dist_by_nb = {str(a.get("neighborhood_id")): float(a.get("distance_km", 0.0) or 0.0)
                  for a in (assignments or [])}
    dists = [dist_by_nb.get(str(n.get("neighborhood_id")), 0.0) for n in nodes]
    lo, hi = min(dists), max(dists)
    span = max(1e-9, hi - lo)
    lats = [float(n["latitude"]) for n in nodes]
    lons = [float(n["longitude"]) for n in nodes]
    min_lat, max_lat = min(lats), max(lats)
    min_lon, max_lon = min(lons), max(lons)
    if abs(max_lat - min_lat) < 1e-6:
        min_lat -= 0.02
        max_lat += 0.02
    if abs(max_lon - min_lon) < 1e-6:
        min_lon -= 0.02
        max_lon += 0.02
    n = max(4, min(48, int(grid_n)))
    cells: List[Dict[str, Any]] = []
    for gi in range(n):
        for gj in range(n):
            clat = min_lat + (max_lat - min_lat) * (gi + 0.5) / n
            clon = min_lon + (max_lon - min_lon) * (gj + 0.5) / n
            num = 0.0
            den = 0.0
            for idx, nd in enumerate(nodes):
                dlat = (float(nd["latitude"]) - clat) * 111.0
                dlon = (float(nd["longitude"]) - clon) * 111.0 * math.cos(math.radians(clat))
                dd = math.hypot(dlat, dlon)
                w = 1.0 / (1.0 + dd)
                num += dists[idx] * w
                den += w
            mean_d = num / den if den > 0 else 0.0
            t = (mean_d - lo) / span
            cells.append({
                "lat": round(clat, 5),
                "lon": round(clon, 5),
                "distance_km": round(mean_d, 2),
                "t": round(max(0.0, min(1.0, t)), 3),
                "color": proximity_color(t),
            })
    hotspots: List[Dict[str, Any]] = []
    if top_k and top_k > 0:
        ranked = sorted(nodes,
                        key=lambda x: dist_by_nb.get(str(x.get("neighborhood_id")), 0.0),
                        reverse=True)[:top_k]
        for nd in ranked:
            nid = str(nd.get("neighborhood_id"))
            d = dist_by_nb.get(nid, 0.0)
            t = (d - lo) / span
            hotspots.append({
                "neighborhood_id": nid,
                "distance_km": round(d, 2),
                "t": round(max(0.0, min(1.0, t)), 3),
                "color": proximity_color(t),
            })
    return {"cells": cells, "min_km": round(lo, 2), "max_km": round(hi, 2),
            "grid_n": n, "hotspots": hotspots}


def corridor_traffic_summary(assignments: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Phase B (#5 display): per-corridor congestion buckets for the traffic overlay.

    Reads assignment.congestion_pct + travel_time_min outputs only (no engine
    changes). Buckets: fluid (<0.15) / busy (<0.4) / jammed (>=0.4).
    """
    buckets = {"fluid": 0, "busy": 0, "jammed": 0, "unknown": 0}
    by_warehouse: Dict[str, Dict[str, Any]] = {}
    for a in (assignments or []):
        c = a.get("congestion_pct")
        wid = str(a.get("warehouse_id"))
        slot = by_warehouse.setdefault(wid, {"fluid": 0, "busy": 0, "jammed": 0, "unknown": 0})
        if c is None:
            buckets["unknown"] += 1
            slot["unknown"] += 1
            continue
        try:
            v = float(c)
        except (TypeError, ValueError):
            buckets["unknown"] += 1
            slot["unknown"] += 1
            continue
        label = "fluid" if v < 0.15 else ("busy" if v < 0.4 else "jammed")
        buckets[label] += 1
        slot[label] += 1
    congs = [float(a["congestion_pct"]) for a in (assignments or [])
             if a.get("congestion_pct") is not None]
    return {
        "buckets": buckets,
        "by_warehouse": by_warehouse,
        "avg_congestion_pct": round(sum(congs) / len(congs), 4) if congs else 0.0,
        "total": len(assignments or []),
    }


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
