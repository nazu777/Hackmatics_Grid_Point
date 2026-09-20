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
