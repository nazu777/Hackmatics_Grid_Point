"""
GridPoint Road Routing Provider
Real road-network distances (and travel times) for optimization, replacing
straight-line displacement when distance_metric == "road".

Provider chain (per chunk, first success wins):
  1. TomTom Matrix v2 (many-to-many, ONE call per chunk, live traffic when
     requested) — needs TOMTOM_KEY, otherwise skipped silently.
  2. OSRM public table API (free, keyless, one call per chunk).
  3. Haversine fallback (never fails; flagged in the note).

Results are TTL-cached in memory keyed by rounded coordinates so repeated
runs and baseline-vs-optimized evaluations reuse segments. No key is ever
returned in API output.
"""
import json
import math
import os
import time
import urllib.request
import urllib.parse
from typing import Dict, List, Optional, Tuple

import numpy as np

from .distance import haversine_distance_matrix

TOMTOM_MATRIX_URL = "https://api.tomtom.com/routing/matrix/2/summary/json"
OSRM_TABLE_URL = "https://router.project-osrm.org/table/v1/driving"
MATRIX_TTL_S = 15 * 60
MAX_COORDS_PER_CALL = 95  # stay under OSRM's 100-coordinate request limit


def _round_pt(lat: float, lon: float) -> Tuple[float, float]:
    return (round(float(lat), 4), round(float(lon), 4))


def _haversine_km(a: Tuple[float, float], b: Tuple[float, float]) -> float:
    dlat = math.radians(b[0] - a[0])
    dlon = math.radians(b[1] - a[1])
    s = (math.sin(dlat / 2) ** 2
         + math.cos(math.radians(a[0])) * math.cos(math.radians(b[0]))
         * math.sin(dlon / 2) ** 2)
    return 6371.0088 * 2 * math.asin(min(1.0, math.sqrt(max(0.0, s))))


def _tomtom_matrix(origins: List[Tuple[float, float]],
                   dests: List[Tuple[float, float]],
                   live_traffic: bool) -> Optional[Tuple[np.ndarray, Optional[np.ndarray]]]:
    """TomTom Matrix v2, single call. Returns (dist_km, dur_min) or None."""
    key = os.environ.get("TOMTOM_KEY", "").strip()
    if not key:
        return None
    body = json.dumps({
        "origins": [{"point": {"latitude": la, "longitude": lo}} for la, lo in origins],
        "destinations": [{"point": {"latitude": la, "longitude": lo}} for la, lo in dests],
        "options": {
            "traffic": bool(live_traffic),
            "travelMode": "car",
            "routeType": "fastest",
            "departAt": "now" if live_traffic else None,
        },
    }).encode("utf-8")
    url = f"{TOMTOM_MATRIX_URL}?key={urllib.parse.quote(key)}"
    req = urllib.request.Request(url, data=body,
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except Exception:
        return None
    try:
        rows = payload["matrix"]
        dist = np.zeros((len(origins), len(dests)), dtype=float)
        dur = np.zeros((len(origins), len(dests)), dtype=float)
        for i, row in enumerate(rows):
            for j, cell in enumerate(row):
                if not isinstance(cell, dict) or cell.get("status") != "OK":
                    return None
                summary = cell.get("routeSummary", {})
                length_m = summary.get("lengthInMeters")
                time_s = summary.get("travelTimeInSeconds")
                if length_m is None or time_s is None:
                    return None
                dist[i, j] = float(length_m) / 1000.0
                dur[i, j] = float(time_s) / 60.0
        return dist, dur
    except (KeyError, TypeError, ValueError):
        return None


def _osrm_table(origins: List[Tuple[float, float]],
                dests: List[Tuple[float, float]]) -> Optional[Tuple[np.ndarray, Optional[np.ndarray]]]:
    """OSRM public table API, single call. Returns (dist_km, dur_min) or None."""
    try:
        all_pts = origins + dests
        coord_str = ";".join(f"{lo},{la}" for la, lo in all_pts)
        src = ";".join(str(i) for i in range(len(origins)))
        dst = ";".join(str(len(origins) + j) for j in range(len(dests)))
        url = (f"{OSRM_TABLE_URL}/{coord_str}"
               f"?sources={src}&destinations={dst}&annotations=distance,duration")
        req = urllib.request.Request(url, headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=20) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
        if not isinstance(payload, dict) or payload.get("code") != "Ok":
            return None
        distances = payload.get("distances")
        durations = payload.get("durations")
        if distances is None:
            return None
        dist = np.array(distances, dtype=float) / 1000.0
        dur = (np.array(durations, dtype=float) / 60.0) if durations is not None else None
        if dist.shape != (len(origins), len(dests)):
            return None
        return dist, dur
    except Exception:
        return None


_matrix_cache: Dict[str, Tuple[float, np.ndarray, Optional[np.ndarray], str]] = {}


def _cache_key(origins: List[Tuple[float, float]],
               dests: List[Tuple[float, float]], live_traffic: bool) -> str:
    o = "|".join(f"{la:.4f},{lo:.4f}" for la, lo in origins)
    d = "|".join(f"{la:.4f},{lo:.4f}" for la, lo in dests)
    return f"{hash((o, d, live_traffic)) & 0xFFFFFFFFFFFF}"


def clear_matrix_cache() -> None:
    _matrix_cache.clear()


def fetch_matrix(origins: List[Tuple[float, float]],
                 dests: List[Tuple[float, float]],
                 live_traffic: bool = False) -> Tuple[np.ndarray, Optional[np.ndarray], str]:
    """
    Road distance matrix (N×M km) + optional travel-time matrix (minutes).
    Origins are chunked so each provider call stays under coordinate limits.
    Returns (dist_km, dur_min_or_None, provider_note). Never raises — the
    final fallback is Haversine per chunk.
    """
    origins = [_round_pt(*p) for p in origins]
    dests = [_round_pt(*p) for p in dests]
    key = _cache_key(origins, dests, live_traffic)
    now = time.time()
    hit = _matrix_cache.get(key)
    if hit and (now - hit[0]) < MATRIX_TTL_S:
        return hit[1].copy(), (hit[2].copy() if hit[2] is not None else None), f"{hit[3]} (cached)"

    n, m = len(origins), len(dests)
    dist = np.zeros((n, m), dtype=float)
    dur: Optional[np.ndarray] = np.zeros((n, m), dtype=float)
    providers: List[str] = []
    # Chunk origins; destinations (K ≤ 10) always fit in one call.
    per_call = max(1, MAX_COORDS_PER_CALL - m)
    for start in range(0, n, per_call):
        chunk = origins[start:start + per_call]
        got: Optional[Tuple[np.ndarray, Optional[np.ndarray]]] = None
        provider = "haversine"
        if live_traffic and os.environ.get("TOMTOM_KEY", "").strip():
            got = _tomtom_matrix(chunk, dests, live_traffic=True)
            provider = "tomtom-live" if got else provider
        if got is None:
            got = _osrm_table(chunk, dests)
            provider = "osrm" if got else provider
        if got is None:
            c = np.array(chunk)
            d = np.array(dests)
            got = (haversine_distance_matrix(c, d), None)
            provider = "haversine"
        d_mat, t_mat = got
        dist[start:start + len(chunk), :] = d_mat
        if t_mat is not None:
            dur[start:start + len(chunk), :] = t_mat
        else:
            dur = None
        providers.append(provider)

    used = providers[0] if len(set(providers)) == 1 else "mixed(" + "+".join(sorted(set(providers))) + ")"
    note = {
        "tomtom-live": "Live TomTom road distances + travel times",
        "osrm": "OSRM road distances (free tier, no live traffic)",
        "haversine": "Straight-line fallback (routing unreachable)",
    }.get(used, f"Road distances via {used}")
    _matrix_cache[key] = (now, dist.copy(), dur.copy() if dur is not None else None, used)
    return dist, dur, note


def road_matrices(coords1: np.ndarray, coords2: np.ndarray,
                  live_traffic: bool = False) -> Tuple[np.ndarray, Optional[np.ndarray], str]:
    """ndarray convenience wrapper around fetch_matrix."""
    c1 = np.atleast_2d(coords1)
    c2 = np.atleast_2d(coords2)
    if c1.shape[0] == 0 or c2.shape[0] == 0:
        return np.empty((c1.shape[0], c2.shape[0])), None, "empty"
    origins = [(float(la), float(lo)) for la, lo in c1]
    dests = [(float(la), float(lo)) for la, lo in c2]
    return fetch_matrix(origins, dests, live_traffic=live_traffic)
