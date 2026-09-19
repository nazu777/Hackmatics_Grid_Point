"""
GridPoint US Census Demand Provider (ACS 5-Year + TIGER Gazetteer)
Real demand for US cities: tract populations from the Census ACS 5-Year API
(B01003_001E total population) joined to tract centroid coordinates from the
annual TIGER Gazetteer files. daily_orders = population × orders_per_1000/1000.

Security: the Census key is ONLY read from the CENSUS_KEY environment
variable — never hardcode it, never commit it, never return it in API output.
Caches (populations 7d, Gazetteer files indefinitely) live under
CENSUS_CACHE_DIR or data/census_cache (best-effort on serverless).
"""
import csv
import io
import json
import os
import time
import urllib.request
import urllib.parse
from typing import Dict, Any, List, Optional, Tuple

ACS_BASE = "https://api.census.gov/data/2023/acs/acs5"
GAZETTEER_BASE = "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2023_Gazetteer"
CACHE_TTL_S = 7 * 24 * 3600

# city_id -> {label, center, counties:[(state, county, county_label)]}
CITY_PRESETS: Dict[str, Dict[str, Any]] = {
    "new-york": {
        "label": "New York, NY",
        "center": {"lat": 40.7128, "lon": -74.0060},
        "counties": [("36", "005", "Bronx"), ("36", "047", "Brooklyn"),
                     ("36", "061", "Manhattan"), ("36", "081", "Queens"),
                     ("36", "085", "Staten Island")],
    },
    "los-angeles": {
        "label": "Los Angeles, CA",
        "center": {"lat": 34.0522, "lon": -118.2437},
        "counties": [("06", "037", "LA County")],
    },
    "las-vegas": {
        "label": "Las Vegas, NV",
        "center": {"lat": 36.1699, "lon": -115.1398},
        "counties": [("32", "003", "Clark County")],
    },
    "chicago": {
        "label": "Chicago, IL",
        "center": {"lat": 41.8781, "lon": -87.6298},
        "counties": [("17", "031", "Cook County")],
    },
    "houston": {
        "label": "Houston, TX",
        "center": {"lat": 29.7604, "lon": -95.3698},
        "counties": [("48", "201", "Harris County")],
    },
    "san-francisco": {
        "label": "San Francisco, CA",
        "center": {"lat": 37.7749, "lon": -122.4194},
        "counties": [("06", "075", "San Francisco")],
    },
}


def api_key_configured() -> bool:
    return bool(os.environ.get("CENSUS_KEY", "").strip())


def cache_dir() -> str:
    return os.environ.get(
        "CENSUS_CACHE_DIR",
        os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                     "..", "data", "census_cache"),
    )


def _read_cache(name: str, ttl: float) -> Optional[Any]:
    try:
        path = os.path.join(cache_dir(), name)
        if not os.path.exists(path):
            return None
        if ttl > 0 and (time.time() - os.path.getmtime(path)) > ttl:
            return None
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def _write_cache(name: str, data: Any) -> None:
    try:
        parent = cache_dir()
        os.makedirs(parent, exist_ok=True)
        with open(os.path.join(parent, name), "w", encoding="utf-8") as f:
            json.dump(data, f)
    except Exception:
        pass  # best-effort (serverless filesystems are ephemeral)


def _http_get(url: str, timeout: int = 25) -> Optional[bytes]:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "GridPoint/1.0"})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.read()
    except Exception:
        return None


def get_tract_populations(state: str, county: str) -> Optional[List[Dict[str, Any]]]:
    """
    ACS5 B01003_001E population per tract. Returns
    [{geoid, name, population}] or None when unreachable.
    Uses CENSUS_KEY when configured (higher quota), else keyless.
    """
    cache_name = f"acs5_2023_{state}_{county}.json"
    cached = _read_cache(cache_name, CACHE_TTL_S)
    if cached is not None:
        return cached
    key = os.environ.get("CENSUS_KEY", "").strip()
    params = f"get=NAME,B01003_001E&for=tract:*&in=state:{state}+county:{county}"
    if key:
        params += f"&key={urllib.parse.quote(key)}"
    raw = _http_get(f"{ACS_BASE}?{params}")
    if raw is None:
        return None
    try:
        rows = json.loads(raw.decode("utf-8"))
    except Exception:
        return None
    if not isinstance(rows, list) or len(rows) < 2:
        return None
    header = rows[0]
    try:
        i_name = header.index("NAME")
        i_pop = header.index("B01003_001E")
        i_state = header.index("state")
        i_county = header.index("county")
        i_tract = header.index("tract")
    except ValueError:
        return None
    out: List[Dict[str, Any]] = []
    for r in rows[1:]:
        try:
            pop = int(float(r[i_pop]))
        except (ValueError, TypeError, IndexError):
            continue
        geoid = f"{r[i_state]}{r[i_county]}{r[i_tract]}"
        out.append({"geoid": geoid, "name": str(r[i_name]), "population": pop})
    _write_cache(cache_name, out)
    return out


def get_tract_centroids(state: str) -> Optional[Dict[str, Tuple[float, float]]]:
    """
    TIGER Gazetteer tract internal points: {geoid: (lat, lon)}.
    Gazetteer files need no key and are cached indefinitely.
    """
    cache_name = f"gazetteer_2023_{state}.json"
    cached = _read_cache(cache_name, 0)
    if cached is not None:
        return {k: (v[0], v[1]) for k, v in cached.items()}
    raw = _http_get(f"{GAZETTEER_BASE}/2023_gaz_tracts_{state}.txt", timeout=40)
    if raw is None:
        return None
    try:
        text = raw.decode("utf-8", errors="ignore")
        reader = csv.DictReader(io.StringIO(text), delimiter="\t")
        # Gazetteer headers are space-padded — normalize before lookup
        if reader.fieldnames:
            reader.fieldnames = [h.strip() for h in reader.fieldnames]
        out: Dict[str, Tuple[float, float]] = {}
        for row in reader:
            try:
                geoid = row["GEOID"].strip()
                lon = row.get("INTPTLON", row.get("INTPTLONG"))
                out[geoid] = (float(row["INTPTLAT"]), float(lon))
            except (KeyError, ValueError, AttributeError, TypeError):
                continue
    except Exception:
        return None
    if not out:
        return None
    _write_cache(cache_name, {k: [v[0], v[1]] for k, v in out.items()})
    return out


def _short_tract_name(acs_name: str, county_label: str) -> str:
    """'Census Tract 1, Bronx County, New York' -> 'Tract 1 · Bronx'."""
    head = acs_name.replace(";", ",").split(",")[0].strip()
    head = head.replace("Census Tract", "Tract")
    short_county = county_label.replace(" County", "")
    if short_county.lower() in head.lower():
        return head
    return f"{head} · {short_county}"


def get_city_demand(city_id: str, orders_per_1000: float = 5.0) -> Dict[str, Any]:
    """
    Real demand nodes for a preset US city. Returns
    {city_id, label, live, neighborhoods:[Neighborhood dicts], tracts, skipped}.
    Raises ValueError for unknown cities, RuntimeError when data unreachable.
    """
    preset = CITY_PRESETS.get(city_id)
    if preset is None:
        raise ValueError(f"Unknown city '{city_id}'. Choose from: {', '.join(CITY_PRESETS)}")
    per_capita = max(0.0, float(orders_per_1000)) / 1000.0
    neighborhoods: List[Dict[str, Any]] = []
    tracts = 0
    skipped = 0
    live = api_key_configured()
    for state, county, county_label in preset["counties"]:
        pops = get_tract_populations(state, county)
        centroids = get_tract_centroids(state)
        if pops is None or centroids is None:
            raise RuntimeError(
                f"Census data unreachable for {county_label} (state {state}, county {county}). "
                "Check connectivity" + ("" if live else " and CENSUS_KEY") + ".")
        for p in pops:
            tracts += 1
            loc = centroids.get(p["geoid"])
            if loc is None:
                skipped += 1
                continue
            lat, lon = loc
            if not (-90.0 <= lat <= 90.0 and -180.0 <= lon <= 180.0):
                skipped += 1
                continue
            neighborhoods.append({
                "neighborhood_id": f"T{p['geoid']}",
                "name": _short_tract_name(p["name"], county_label),
                "latitude": round(lat, 6),
                "longitude": round(lon, 6),
                "daily_orders": max(1, int(round(p["population"] * per_capita))),
                "zone": county_label,
            })
    if not neighborhoods:
        raise RuntimeError("No usable tracts returned for this city.")
    return {"city_id": city_id, "label": preset["label"], "live": live,
            "neighborhoods": neighborhoods, "tracts": tracts, "skipped": skipped,
            "center": preset["center"]}


def list_cities() -> List[Dict[str, Any]]:
    """Preset metadata for the city picker (no network)."""
    return [{"city_id": cid, "label": p["label"], "center": p["center"],
             "counties": [c[2] for c in p["counties"]]}
            for cid, p in CITY_PRESETS.items()]
