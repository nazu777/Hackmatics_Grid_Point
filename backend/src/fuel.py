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
              state: str = "Karnataka") -> Tuple[Optional[float], bool, Optional[str]]:
    """
    ₹/litre for a fuel type (petrol|diesel|cng|autogas, case-insensitive).
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
        row = match or info["cities"][0]
        price = row.get(key)
        if price is not None:
            return price, True, row["city"]
    return FALLBACK_PRICES[key], False, None
