"""
GridPoint Live Traffic Provider (TomTom) + Corridor History
- Live: TomTom Traffic Flow `flowSegmentData/absolute` per point (cached, TTL).
- History: rolling per-cell × hour-of-day delay observations, persisted
  best-effort to JSON (ephemeral on serverless; durable locally), so the
  optimizer learns past congestion for a corridor and hour.

Security: the TomTom key is ONLY read from the TOMTOM_KEY environment
variable — never hardcode it, never commit it, never return it in API output.
Without a key the provider reports live=False and the engine falls back to
history + the manual traffic_factor floor.
"""
import json
import math
import os
import time
import urllib.request
import urllib.parse
from typing import Dict, Any, List, Optional, Tuple

TOMTOM_FLOW_URL = "https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/10/json"
FLOW_TTL_S = 5 * 60  # live segment data refreshes every few minutes
HISTORY_MAX_PER_CELL = 200  # cap memory / file growth


def api_key_configured() -> bool:
    return bool(os.environ.get("TOMTOM_KEY", "").strip())


def history_path() -> str:
    """JSON path for the rolling history (env override for tests)."""
    return os.environ.get(
        "TRAFFIC_HISTORY_PATH",
        os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                     "..", "data", "traffic_history.json"),
    )


def cell_of(lat: float, lon: float) -> Tuple[float, float]:
    """~1.1km coarse cell so nearby corridors share history."""
    return (round(float(lat), 2), round(float(lon), 2))


def _fetch_flow(lat: float, lon: float) -> Optional[Dict[str, Any]]:
    """Raw TomTom call. Returns the flowSegmentData dict or None on failure."""
    key = os.environ.get("TOMTOM_KEY", "").strip()
    if not key:
        return None
    url = (f"{TOMTOM_FLOW_URL}?point={lat},{lon}"
           f"&key={urllib.parse.quote(key)}")
    req = urllib.request.Request(url, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=8) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except Exception:
        return None
    if not isinstance(payload, dict):
        return None
    seg = payload.get("flowSegmentData")
    return seg if isinstance(seg, dict) else None


def delay_from_segment(seg: Dict[str, Any]) -> Tuple[float, Dict[str, Any]]:
    """
    delay_ratio ≥ 0 from a flow segment (0 = free flow).
    Prefers speed ratio, falls back to travel-time ratio.
    Returns (delay_ratio, detail dict with speeds/confidence).
    """
    def _f(v: Any) -> Optional[float]:
        try:
            f = float(v)
            return f if f > 0 else None
        except (ValueError, TypeError):
            return None

    cur = _f(seg.get("currentSpeed"))
    free = _f(seg.get("freeFlowSpeed"))
    delay: Optional[float] = None
    if cur is not None and free is not None:
        delay = max(0.0, free / cur - 1.0)
    else:
        cur_t = _f(seg.get("currentTravelTime"))
        free_t = _f(seg.get("freeFlowTravelTime"))
        if cur_t is not None and free_t is not None:
            delay = max(0.0, cur_t / free_t - 1.0)
    if delay is None:
        delay = 0.0
    detail = {
        "current_speed_kmph": cur,
        "free_flow_speed_kmph": free,
        "current_travel_time_s": _f(seg.get("currentTravelTime")),
        "free_flow_travel_time_s": _f(seg.get("freeFlowTravelTime")),
        "confidence": _f(seg.get("confidence")),
        "road_closure": bool(seg.get("roadClosure", False)),
        "frc": seg.get("frc"),
    }
    return delay, detail


_flow_cache: Dict[Tuple[float, float], Tuple[float, float, Dict[str, Any]]] = {}
# (cell) -> (fetched_at, delay_ratio, detail)


def get_flow(lat: float, lon: float) -> Dict[str, Any]:
    """
    Live segment for a point (TTL-cached). Shape:
    {live, delay_ratio, detail, cell}. live=False when keyless/unreachable.
    """
    cell = cell_of(lat, lon)
    now = time.time()
    hit = _flow_cache.get(cell)
    if hit and (now - hit[0]) < FLOW_TTL_S:
        return {"live": True, "delay_ratio": hit[1], "detail": hit[2], "cell": cell}
    seg = _fetch_flow(round(lat, 5), round(lon, 5))
    if seg is None:
        return {"live": False, "delay_ratio": 0.0, "detail": {}, "cell": cell}
    delay, detail = delay_from_segment(seg)
    _flow_cache[cell] = (now, delay, detail)
    return {"live": True, "delay_ratio": delay, "detail": detail, "cell": cell}


def clear_flow_cache() -> None:
    _flow_cache.clear()


# ---------------- Rolling history ----------------

_history: Dict[str, List[Dict[str, Any]]] = {}
_history_loaded = False


def _history_key(cell: Tuple[float, float], hour: int) -> str:
    return f"{cell[0]:.2f},{cell[1]:.2f}@{hour % 24}"


def _load_history() -> None:
    global _history_loaded
    if _history_loaded:
        return
    _history_loaded = True
    try:
        with open(history_path(), "r", encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, dict):
            for k, v in data.items():
                if isinstance(k, str) and isinstance(v, list):
                    _history[k] = [e for e in v if isinstance(e, dict)][:HISTORY_MAX_PER_CELL]
    except Exception:
        pass


def _save_history() -> None:
    try:
        path = history_path()
        parent = os.path.dirname(os.path.abspath(path))
        if parent and not os.path.exists(parent):
            os.makedirs(parent, exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(_history, f)
    except Exception:
        pass  # best-effort: serverless filesystems are ephemeral/read-only


def record_observation(lat: float, lon: float, delay_ratio: float,
                       hour: Optional[int] = None) -> None:
    """Append a delay observation for a cell × hour bucket."""
    _load_history()
    h = hour if hour is not None else time.localtime().tm_hour
    key = _history_key(cell_of(lat, lon), h)
    bucket = _history.setdefault(key, [])
    bucket.append({"at": time.time(), "delay": max(0.0, float(delay_ratio))})
    if len(bucket) > HISTORY_MAX_PER_CELL:
        del bucket[:-HISTORY_MAX_PER_CELL]
    _save_history()


def clear_history() -> None:
    _history.clear()
    global _history_loaded
    _history_loaded = True


def historical_factor(lat: float, lon: float, hour: Optional[int] = None) -> Tuple[float, int]:
    """
    Mean recorded delay for a cell × hour. Falls back to the cell's all-hours
    mean, else (0.0, 0 samples). Returns (factor, samples).
    """
    _load_history()
    h = hour if hour is not None else time.localtime().tm_hour
    cell = cell_of(lat, lon)
    bucket = _history.get(_history_key(cell, h), [])
    if bucket:
        return sum(e["delay"] for e in bucket) / len(bucket), len(bucket)
    prefix = f"{cell[0]:.2f},{cell[1]:.2f}@"
    all_obs = [e["delay"] for k, v in _history.items() if k.startswith(prefix) for e in v]
    if all_obs:
        return sum(all_obs) / len(all_obs), len(all_obs)
    return 0.0, 0


def corridor_factor(lat: float, lon: float, manual_floor: float = 0.0,
                    hour: Optional[int] = None, record: bool = True,
                    allow_live: bool = True) -> Dict[str, Any]:
    """
    Congestion factor for a warehouse corridor: live TomTom reading when
    allowed AND available (recorded to history), else the historical mean for
    this cell × hour, never below the manual traffic_factor floor.
    Returns {factor, live, historical, samples, detail}.
    """
    flow = get_flow(lat, lon) if allow_live else {"live": False}
    hist, samples = historical_factor(lat, lon, hour)
    if flow.get("live"):
        factor = max(float(manual_floor), float(flow["delay_ratio"]))
        if record:
            record_observation(lat, lon, float(flow["delay_ratio"]), hour)
        return {"factor": factor, "live": True, "historical": hist,
                "samples": samples, "detail": flow.get("detail", {})}
    factor = max(float(manual_floor), hist)
    return {"factor": factor, "live": False, "historical": hist,
            "samples": samples, "detail": {}}


def historical_corridors(coords: "np.ndarray", hour: Optional[int] = None):
    """
    Vector of historical congestion factors for candidate sites (no network).
    Returns (factors ndarray, total samples). Used to steer MILP placement
    toward historically fluid corridors.
    """
    import numpy as np
    factors = []
    samples = 0
    for lat, lon in np.atleast_2d(coords):
        hist, n = historical_factor(float(lat), float(lon), hour)
        factors.append(hist)
        samples += n
    return np.array(factors, dtype=float), samples


# ---------------- Phase C: corridor traffic from road geometries ----------------
# Backlog #5 (engine half): traced road polylines feed live routing decisions.
# A corridor is the set of road segments between a neighborhood and its
# warehouse. We sample points along each corridor (node + midpoint +
# warehouse, or vertices of a traced geometry line), read live flow per
# sample, and average into a per-warehouse congestion factor that is
# recorded into rolling history — the same history the MILP placement and
# evaluation path already consume.

def sample_route_points(frm: Tuple[float, float], to: Tuple[float, float],
                        max_samples: int = 3) -> List[Tuple[float, float]]:
    """Evenly spaced (lat, lon) samples along a straight corridor segment."""
    n = max(2, min(7, int(max_samples or 3)))
    lat1, lon1 = float(frm[0]), float(frm[1])
    lat2, lon2 = float(to[0]), float(to[1])
    if n == 2:
        return [(lat1, lon1), (lat2, lon2)]
    return [(lat1 + (lat2 - lat1) * i / (n - 1),
             lon1 + (lon2 - lon1) * i / (n - 1)) for i in range(n)]


def sample_geometry_line(line: List[List[float]],
                         max_samples: int = 5) -> List[Tuple[float, float]]:
    """
    Sample (lat, lon) points from a traced route line ([[lon, lat], ...]).
    Evenly decimates vertices so long polylines cost a bounded number of
    (cached) flow lookups.
    """
    if not line:
        return []
    pts: List[Tuple[float, float]] = []
    for p in line:
        try:
            pts.append((float(p[1]), float(p[0])))
        except (TypeError, ValueError, IndexError):
            continue
    if not pts:
        return []
    n = max(1, min(max(1, len(pts)), int(max_samples or 5)))
    if n >= len(pts):
        return pts
    idx = [round(i * (len(pts) - 1) / (n - 1)) for i in range(n)]
    return [pts[i] for i in sorted(set(idx))]


def aggregate_corridor_congestion(
    points_by_warehouse: Dict[str, List[Tuple[float, float]]],
    manual_floor: float = 0.0,
    hour: Optional[int] = None,
    record: bool = True,
    allow_live: bool = True,
) -> Dict[str, Dict[str, Any]]:
    """
    Per-warehouse congestion from sampled corridor points.

    Each point contributes its live delay_ratio (or 0 when offline); the
    warehouse factor is max(manual_floor, mean delay). Live readings are
    recorded into rolling history per point so future history-only runs
    learn the corridor. Deduplicates points at cell granularity so shared
    segments are fetched once (flow cache is cell-keyed anyway).

    Returns {warehouse_id: {factor, live, samples, points, avg_delay}}.
    """
    out: Dict[str, Dict[str, Any]] = {}
    for wid, pts in (points_by_warehouse or {}).items():
        delays: List[float] = []
        live_any = False
        seen_cells = set()
        for lat, lon in pts or []:
            try:
                cell = cell_of(float(lat), float(lon))
            except (TypeError, ValueError):
                continue
            if cell in seen_cells:
                continue
            seen_cells.add(cell)
            flow = get_flow(float(lat), float(lon)) if allow_live else {"live": False}
            hist, _ = historical_factor(float(lat), float(lon), hour)
            if flow.get("live"):
                d = max(0.0, float(flow.get("delay_ratio", 0.0) or 0.0))
                live_any = True
                if record:
                    record_observation(float(lat), float(lon), d, hour)
            else:
                d = max(0.0, float(hist or 0.0))
            delays.append(d)
        hist_samples = 0
        for lat, lon in pts or []:
            try:
                _, n = historical_factor(float(lat), float(lon), hour)
                hist_samples += int(n)
            except (TypeError, ValueError):
                continue
        avg = sum(delays) / len(delays) if delays else 0.0
        out[str(wid)] = {
            "factor": max(float(manual_floor or 0.0), float(avg)),
            "live": live_any,
            "samples": hist_samples,
            "points": len(seen_cells),
            "avg_delay": round(float(avg), 4),
        }
    return out


def corridor_points_from_assignments(
    neighborhoods: List[Dict[str, Any]],
    warehouses: List[Any],
    assignments: List[Any],
    samples_per_corridor: int = 3,
    geometry_by_pair: Optional[Dict[Tuple[str, str], List[List[float]]]] = None,
    max_samples_geometry: int = 5,
) -> Dict[str, List[Tuple[float, float]]]:
    """
    Build sampled corridor points per warehouse from an assignment.

    When traced geometry lines are supplied (keyed by
    (neighborhood_id, warehouse_id)), samples come from the real road
    polyline; otherwise each corridor contributes node + midpoint +
    warehouse samples along the straight segment. Accepts both dict and
    pydantic Warehouse/Assignment shapes (read-only).
    """
    def _get(obj: Any, key: str, default: Any = None) -> Any:
        if isinstance(obj, dict):
            return obj.get(key, default)
        return getattr(obj, key, default)

    nb_by_id = {str(_get(n, "neighborhood_id")): n for n in (neighborhoods or [])}
    wh_by_id = {str(_get(w, "warehouse_id")): w for w in (warehouses or [])}
    points: Dict[str, List[Tuple[float, float]]] = {}
    for a in assignments or []:
        nid = str(_get(a, "neighborhood_id"))
        wid = str(_get(a, "warehouse_id"))
        nb = nb_by_id.get(nid)
        wh = wh_by_id.get(wid)
        if nb is None or wh is None:
            continue
        try:
            nlat, nlon = float(_get(nb, "latitude")), float(_get(nb, "longitude"))
            wlat, wlon = float(_get(wh, "latitude")), float(_get(wh, "longitude"))
        except (TypeError, ValueError):
            continue
        geom = (geometry_by_pair or {}).get((nid, wid))
        if geom:
            sampled = sample_geometry_line(geom, max_samples=max_samples_geometry)
        else:
            sampled = sample_route_points((nlat, nlon), (wlat, wlon),
                                          max_samples=samples_per_corridor)
        points.setdefault(wid, []).extend(sampled)
    return points


def corridor_traffic_from_assignments(
    neighborhoods: List[Dict[str, Any]],
    warehouses: List[Any],
    assignments: List[Any],
    manual_floor: float = 0.0,
    hour: Optional[int] = None,
    record: bool = True,
    allow_live: bool = True,
    samples_per_corridor: int = 3,
    geometry_by_pair: Optional[Dict[Tuple[str, str], List[List[float]]]] = None,
) -> Dict[str, Dict[str, Any]]:
    """
    One-call corridor traffic: sample each assigned road corridor, aggregate
    per-warehouse congestion, and persist live readings to rolling history.
    This is the engine-half feed behind "optimize on current traffic".
    """
    pts = corridor_points_from_assignments(
        neighborhoods, warehouses, assignments,
        samples_per_corridor=samples_per_corridor,
        geometry_by_pair=geometry_by_pair)
    if not pts and warehouses:
        # No assignments yet (e.g. pre-optimization): fall back to one
        # warehouse-center sample per site so corridors still report.
        def _get(obj: Any, key: str, default: Any = None) -> Any:
            if isinstance(obj, dict):
                return obj.get(key, default)
            return getattr(obj, key, default)
        for w in warehouses:
            try:
                pts.setdefault(str(_get(w, "warehouse_id")), []).append(
                    (float(_get(w, "latitude")), float(_get(w, "longitude"))))
            except (TypeError, ValueError):
                continue
    return aggregate_corridor_congestion(
        pts, manual_floor=manual_floor, hour=hour,
        record=record, allow_live=allow_live)


# ---------------- Phase L: dynamic zone traffic (followup #9) ----------------
# City split into radial zones (centre high -> outer low), red/yellow/green,
# refreshing in realtime (time wave + deterministic jitter) and feeding
# routes/ETA/fuel through the existing corridor_factor path (extend, not fork).
# Contract (docs/followup_phases.md §1.3):
#   GET /api/traffic/zones -> {zones: [{zone_id, name, intensity 0..1,
#     level low|medium|high, polygon [[lon,lat]...]}], live: bool}
#   helper zone_factor(lat, lon) -> float (Phase I imports this; falls back
#   to corridor/manual floor when zones unavailable).

ZONE_LEVELS = ("low", "medium", "high")
ZONE_COLORS = {"high": "#ef4444", "medium": "#f59e0b", "low": "#22c55e"}


def _zone_level(intensity: float) -> str:
    v = max(0.0, min(1.0, float(intensity)))
    if v >= 0.55:
        return "high"
    if v >= 0.28:
        return "medium"
    return "low"


def _demand_centroid(neighborhoods: List[Dict[str, Any]]) -> Optional[Tuple[float, float]]:
    pts = []
    for n in neighborhoods or []:
        try:
            pts.append((float(n.get("latitude")), float(n.get("longitude"))))
        except (TypeError, ValueError):
            continue
    if not pts:
        return None
    return (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))


def _zone_jitter(zone_id: str, tick: int) -> float:
    """Deterministic ±0.06 jitter per zone + tick (no RNG state)."""
    import hashlib
    h = hashlib.md5(f"{zone_id}@{tick}".encode()).hexdigest()
    return (int(h[:8], 16) % 1200) / 10000.0 - 0.06


def zone_intensity_at(lat: float, lon: float,
                      center: Optional[Tuple[float, float]],
                      max_radius_km: float = 20.0,
                      tick: int = 0) -> float:
    """
    Radial falloff from the demand centroid (centre-high -> edge-low) with a
    realtime time wave + deterministic jitter. Pure function so tests + the
    offline fallback stay reproducible.
    """
    import math
    if center is None:
        base = 0.35
    else:
        try:
            dlat = (float(lat) - center[0]) * 111.0
            dlon = (float(lon) - center[1]) * 111.0 * math.cos(math.radians(center[0]))
            dist = math.hypot(dlat, dlon)
        except (TypeError, ValueError):
            dist = 0.0
        frac = min(1.0, dist / max(1.0, max_radius_km))
        base = 0.85 * (1.0 - frac) + 0.12 * frac
    wave = 0.08 * math.sin(float(tick) / 3.0)
    return max(0.0, min(1.0, base + wave))


def zone_factor(lat: float, lon: float,
                neighborhoods: Optional[List[Dict[str, Any]]] = None,
                tick: int = 0) -> float:
    """
    Phase I entry point: congestion factor for a point from the zone model.
    Falls back to corridor/manual floor when zones unavailable (empty data) —
    callers must keep working if L is late (followup §1.3).
    """
    try:
        center = _demand_centroid(neighborhoods or [])
        return zone_intensity_at(float(lat), float(lon), center, tick=int(tick))
    except (TypeError, ValueError):
        return 0.0


def build_traffic_zones(neighborhoods: List[Dict[str, Any]],
                        rings: int = 3,
                        segments: int = 12,
                        tick: int = 0,
                        max_radius_km: float = 20.0) -> Dict[str, Any]:
    """
    Concentric ring zones around the demand centroid. Each ring is split into
    `segments` wedge polygons so the map renders centre-high -> edge-low
    variation (not one flat disc). Intensities shift across ticks via the
    time wave + per-zone jitter.
    """
    import math
    center = _demand_centroid(neighborhoods or [])
    live = api_key_configured()
    if center is None:
        return {"zones": [], "live": live, "tick": int(tick)}
    clat, clon = center
    # Degree steps scaled at the centroid latitude (WGS84 in, km logic).
    lat_deg_per_km = 1.0 / 110.574
    lon_deg_per_km = 1.0 / (111.320 * max(0.1, math.cos(math.radians(clat))))
    radii = [(max_radius_km * (r + 1) / max(1, rings)) for r in range(max(1, rings))]
    zones: List[Dict[str, Any]] = []
    for ri, radius in enumerate(radii):
        inner = radii[ri - 1] if ri > 0 else 0.0
        for s in range(max(3, segments)):
            a0 = 2 * math.pi * s / max(3, segments)
            a1 = 2 * math.pi * (s + 1) / max(3, segments)
            ring: List[List[float]] = []
            steps = 6
            for i in range(steps + 1):
                a = a0 + (a1 - a0) * i / steps
                ring.append([round(clon + radius * math.sin(a) * lon_deg_per_km, 5),
                             round(clat + radius * math.cos(a) * lat_deg_per_km, 5)])
            for i in range(steps, -1, -1):
                a = a0 + (a1 - a0) * i / steps
                r = inner if inner > 0 else 0.0
                ring.append([round(clon + r * math.sin(a) * lon_deg_per_km, 5),
                             round(clat + r * math.cos(a) * lat_deg_per_km, 5)])
            mid_a = (a0 + a1) / 2.0
            mid_r = (inner + radius) / 2.0
            mlat = clat + mid_r * math.cos(mid_a) * lat_deg_per_km
            mlon = clon + mid_r * math.sin(mid_a) * lon_deg_per_km
            intensity = max(0.0, min(1.0, zone_intensity_at(
                mlat, mlon, center, max_radius_km=max_radius_km, tick=tick)
                + _zone_jitter(f"ring{ri}-seg{s}", tick)))
            level = _zone_level(intensity)
            zones.append({
                "zone_id": f"ring{ri}-seg{s}",
                "name": f"{'Centre' if ri == 0 else ('Midtown' if ri == 1 else 'Outer')} {s + 1}",
                "intensity": round(intensity, 3),
                "level": level,
                "color": ZONE_COLORS[level],
                "polygon": ring,
            })
    return {"zones": zones, "live": live, "tick": int(tick),
            "center": {"lat": round(clat, 5), "lon": round(clon, 5)}}
