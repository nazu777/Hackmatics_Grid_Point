"""
GridPoint Live Fuel Price Provider
Fetches daily petrol/diesel/CNG rates per Indian state via RapidAPI
(daily-fuel-prices-in-india-api), with TTL caching and offline fallback.

Security: the RapidAPI key is ONLY read from the RAPIDAPI_KEY environment
variable — never hardcode it, never commit it, never return it in API output.
Without a key (local dev, tests) the provider serves static fallback rates
and reports live=False so the UI can badge prices honestly.
"""
import json
import os
import time
import urllib.request
import urllib.parse
from typing import Dict, Any, List, Optional, Tuple

RAPIDAPI_HOST = "daily-fuel-prices-in-india-api.p.rapidapi.com"
FUEL_TTL_S = 12 * 3600  # refresh at most twice daily

# Fallback ₹/litre used when no key is configured or the API is unreachable.
FALLBACK_PRICES = {"petrol": 105.0, "diesel": 92.0, "cng": 90.0, "autogas": 40.0}

# Approximate centroids for auto-matching a dataset to its nearest price city.
# Used so the UI never has to ask which city to price fuel at.
CITY_COORDS = {
    "Bagalkot": (16.18, 75.70), "Ballari": (15.14, 76.93), "Belgaum": (15.85, 74.51),
    "Bengaluru": (12.97, 77.59), "Bidar": (17.91, 77.52), "Chamarajanagar": (11.93, 76.95),
    "Chickmagaluru": (13.32, 75.77), "Chikkaballapura": (13.43, 77.73),
    "Chitradurga": (14.23, 76.40), "Davangere": (14.47, 75.92), "Dharwad": (15.46, 75.01),
    "Gadag": (15.43, 75.63), "Gulbarga": (17.33, 76.83), "Hassan": (13.01, 76.10),
    "Haveri": (14.80, 75.14), "Karwar": (14.81, 74.13), "Kolar": (13.14, 78.13),
    "Koppal": (15.35, 76.15), "Mandya": (12.52, 76.90), "Mangalore": (12.91, 74.86),
    "Mysore": (12.30, 76.65), "Raichur": (16.21, 77.36), "Ramanagara": (12.72, 77.28),
    "Shimoga": (13.93, 75.57), "Tumakuru": (13.34, 77.10), "Udupi": (13.34, 74.75),
    "Yadgir": (16.77, 77.13),
}


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    import math
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    s = (math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1))
         * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2)
    return 6371.0088 * 2 * math.asin(min(1.0, math.sqrt(max(0.0, s))))


def nearest_city(lat: float, lon: float, cities: List[Dict[str, Any]]) -> Optional[str]:
    """Closest priced city to a dataset center (by haversine km)."""
    best, best_d = None, float("inf")
    for c in cities:
        loc = CITY_COORDS.get(str(c.get("city", "")).strip())
        if not loc:
            continue
        d = _haversine_km(lat, lon, loc[0], loc[1])
        if d < best_d:
            best, best_d = str(c["city"]), d
    return best

_cache: Dict[str, Any] = {"at": 0.0, "state": None, "cities": None}


def api_key_configured() -> bool:
    return bool(os.environ.get("RAPIDAPI_KEY", "").strip())


def _to_float(v: Any) -> Optional[float]:
    try:
        if v is None:
            return None
        f = float(str(v).strip())
        return f if f > 0 else None
    except (ValueError, TypeError):
        return None


def _fetch_state(state: str) -> Optional[List[Dict[str, Any]]]:
    """Raw RapidAPI call. Returns city rows or None on any failure."""
    key = os.environ.get("RAPIDAPI_KEY", "").strip()
    if not key:
        return None
    url = (
        f"https://{RAPIDAPI_HOST}/api/Petrol-Diesel-Cng-Rates/state/"
        f"?state={urllib.parse.quote(state)}"
    )
    req = urllib.request.Request(
        url,
        headers={
            "Content-Type": "application/json",
            "x-rapidapi-host": RAPIDAPI_HOST,
            "x-rapidapi-key": key,
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=8) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except Exception:
        return None
    if not isinstance(payload, dict) or not payload.get("status"):
        return None
    data = payload.get("data")
    return data if isinstance(data, list) else None


def _normalize(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for r in rows:
        if not isinstance(r, dict) or not r.get("city"):
            continue
        out.append({
            "city": str(r["city"]),
            "petrol": _to_float(r.get("petrol")),
            "diesel": _to_float(r.get("diesel")),
            "cng": _to_float(r.get("cng")),
            "autogas": _to_float(r.get("autogas")),
        })
    return out


def get_state_rates(state: str = "Karnataka") -> Dict[str, Any]:
    """
    Returns {state, live, cities:[{city,petrol,diesel,cng,autogas}], defaults}.
    Cached per state for FUEL_TTL_S. live=False when serving fallbacks.
    """
    now = time.time()
    if _cache["cities"] is not None and _cache["state"] == state and (now - _cache["at"]) < FUEL_TTL_S:
        return {"state": state, "live": True, "cities": _cache["cities"], "defaults": FALLBACK_PRICES}

    rows = _fetch_state(state)
    if rows:
        cities = _normalize(rows)
        if cities:
            _cache.update({"at": now, "state": state, "cities": cities})
            return {"state": state, "live": True, "cities": cities, "defaults": FALLBACK_PRICES}
    _cache.update({"at": 0.0, "state": None, "cities": None})
    return {"state": state, "live": False, "cities": [], "defaults": FALLBACK_PRICES}


def clear_cache() -> None:
    _cache.update({"at": 0.0, "state": None, "cities": None})


def price_for(fuel_type: str, city: Optional[str] = None,
              state: str = "Karnataka",
              near: Optional[Tuple[float, float]] = None) -> Tuple[Optional[float], bool, Optional[str]]:
    """
    ₹/litre for a fuel type (petrol|diesel|cng|autogas, case-insensitive).
    City resolution: explicit city first, else nearest priced city to `near`
    (dataset center lat/lon) so callers never have to ask the user.
    Returns (price, live, city_used). Unknown fuel types → (None, live, None).
    Falls back to static defaults when offline/keyless.
    """
    key = (fuel_type or "").strip().lower()
    if key not in ("petrol", "diesel", "cng", "autogas"):
        return None, False, None
    info = get_state_rates(state)
    live = bool(info["live"])
    if live and info["cities"]:
        match = None
        if city:
            lowered = city.strip().lower()
            match = next((c for c in info["cities"] if c["city"].strip().lower() == lowered), None)
        if match is None and near is not None:
            auto = nearest_city(near[0], near[1], info["cities"])
            if auto:
                match = next((c for c in info["cities"] if c["city"] == auto), None)
        row = match or info["cities"][0]
        price = row.get(key)
        if price is not None:
            return price, True, row["city"]
    return FALLBACK_PRICES[key], False, None


def fuel_rate_per_km(price_per_litre: float, mileage_kmpl: Optional[float]) -> float:
    """Fuel ₹ per km·order for one vehicle: live price ÷ mileage (Phase D #7).

    Returns 0.0 when mileage is unset so callers fall back to the manual
    fuel_cost_per_km surcharge instead of dividing by zero.
    """
    if mileage_kmpl is None or mileage_kmpl <= 0:
        return 0.0
    if price_per_litre is None or price_per_litre <= 0:
        return 0.0
    return float(price_per_litre) / float(mileage_kmpl)
