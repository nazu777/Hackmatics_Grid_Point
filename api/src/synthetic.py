"""
GridPoint Synthetic Dataset Generator
Generates realistic, seedable spatial demand distributions (schema.md §2.8).

City model ("clustered"):
  A believable city has a dense core, populated inner districts in every
  direction, a few satellite hubs, and a sparse outskirt fringe — so generated
  data always covers the centre AND the full spread radius:
    - Urban core (~25%): tight gaussian around the centre, highest orders.
    - Inner districts (~40%): area-uniform disc up to 0.6 * spread, all bearings.
    - Satellite hubs (~25%): `num_clusters` subcentres at 0.55–0.8 * spread.
    - Outskirts (~10%): sparse ring at 0.65–1.0 * spread, lowest orders.
  Order volumes taper with distance from the centre (dense core orders most),
  and a few anchor nodes are always placed within sight of the centre.
"""
import math
from typing import List, Dict, Any, Tuple
import numpy as np
from .schema import SyntheticGenerationConfig

# Realistic locality names, grouped by urban character
CORE_NAMES = [
    "Central Market", "Old City", "Grand Square", "Metro Hub", "Midtown",
    "Financial District", "Market Central", "Downtown", "Civic Centre", "Central Station",
]
INNER_NAMES = [
    "Green Hills", "Riverside", "Lakeview", "Sunrise Colony", "North Gateway",
    "South Port", "East End", "Garden Colony", "University Town", "Mill Quarter",
    "Old Quarter", "Harbor View", "Palm Meadows", "Hill View", "Cantonment",
]
HUB_NAMES = [
    "Tech Park", "Cyber City", "Innovation Zone", "Airport Road", "West Industrial",
    "Logistics Park", "Knowledge Park", "Industrial Estate", "IT Corridor", "Trade Centre",
]
FRINGE_NAMES = [
    "Green Belt", "Farm Lands", "Outer Ring Village", "Highway Hamlet", "Rural Fringe",
    "Quarry Town", "Forest Edge", "Border Post", "Countryside", "Satellite Town",
]

COMPASS = ["North", "North-East", "East", "South-East", "South", "South-West", "West", "North-West"]


def _km_to_deg(lat_center: float) -> Tuple[float, float]:
    """(lat_deg_per_km, lon_deg_per_km) at a given latitude."""
    lat_deg_per_km = 1.0 / 110.574
    rad_lat = math.radians(lat_center)
    lon_deg_per_km = 1.0 / (111.320 * max(0.1, math.cos(rad_lat)))
    return lat_deg_per_km, lon_deg_per_km


def _district_name(bearing_rad: float, inner: bool) -> str:
    """Compass-based district label, e.g. 'Inner West' / 'Outer South-East'."""
    deg = (math.degrees(bearing_rad) % 360.0 + 360.0) % 360.0
    compass = COMPASS[int((deg + 22.5) // 45) % 8]
    return f"{'Inner' if inner else 'Outer'} {compass}"


def _orders_for(rng: np.random.Generator, frac: float, lo: int, hi: int) -> int:
    """
    Order volume tapering with normalized radius frac (0 = centre, 1 = edge):
    high near the core, low at the fringe, with ±15% noise. Clamped to [lo, hi].
    """
    span = max(1, hi - lo)
    base = hi - frac * span * 0.9
    noise = rng.uniform(-0.15, 0.15) * span
    return int(np.clip(round(base + noise), lo, hi))


def generate_synthetic_dataset(config: SyntheticGenerationConfig) -> List[Dict[str, Any]]:
    """
    Generates a synthetic list of neighborhoods according to the specified configuration.
    Uses seedable NumPy random state for deterministic reproducibility.
    """
    rng = np.random.default_rng(config.seed)

    lat_deg_per_km, lon_deg_per_km = _km_to_deg(config.lat_center)
    spread = max(1.0, float(config.spread_km))

    lats: List[float] = []
    lons: List[float] = []
    zones: List[str] = []
    fracs: List[float] = []  # normalized radius 0..1 for order tapering
    name_pool: List[str] = []

    def place(dist_km: float, bearing_rad: float, jitter_km: float,
              zone: str, frac: float, name: str) -> None:
        j_lat = rng.normal(0.0, jitter_km) if jitter_km > 0 else 0.0
        j_lon = rng.normal(0.0, jitter_km) if jitter_km > 0 else 0.0
        lat = config.lat_center + (dist_km * math.cos(bearing_rad) + j_lat) * lat_deg_per_km
        lon = config.lon_center + (dist_km * math.sin(bearing_rad) + j_lon) * lon_deg_per_km
        lats.append(lat)
        lons.append(lon)
        zones.append(zone)
        fracs.append(min(1.0, max(0.0, frac)))
        name_pool.append(name)

    if config.distribution == "uniform":
        for i in range(config.N):
            # Area-uniform disc: sqrt sampling avoids centre pile-up AND edge gaps
            r = spread * math.sqrt(rng.uniform(0.0, 1.0))
            bearing = rng.uniform(0.0, 2 * math.pi)
            place(r, bearing, 0.0, _district_name(bearing, r < 0.5 * spread),
                  r / spread, INNER_NAMES[i % len(INNER_NAMES)])

    elif config.distribution == "gaussian":
        # Centered around (lat_center, lon_center) with standard deviation spread_km / 3
        std_km = spread / 3.0
        for i in range(config.N):
            lat = rng.normal(config.lat_center, std_km * lat_deg_per_km)
            lon = rng.normal(config.lon_center, std_km * lon_deg_per_km)
            lats.append(lat)
            lons.append(lon)
            zones.append("Central-Zone")
            d_lat = (lat - config.lat_center) / lat_deg_per_km
            d_lon = (lon - config.lon_center) / lon_deg_per_km
            fracs.append(min(1.0, math.hypot(d_lat, d_lon) / spread))
            name_pool.append(CORE_NAMES[i % len(CORE_NAMES)])

    else:  # "clustered" (default) — full city model
        n = config.N
        n_core = max(2, round(n * 0.25))
        n_inner = max(2, round(n * 0.40))
        n_hubs = max(0, n - n_core - n_inner - max(1, round(n * 0.10)))
        n_fringe = n - n_core - n_inner - n_hubs

        # 1. Urban core — tight gaussian on the centre, highest orders
        for i in range(n_core):
            r = abs(rng.normal(0.0, 0.10 * spread))
            bearing = rng.uniform(0.0, 2 * math.pi)
            place(r, bearing, 0.02 * spread, "City Centre",
                  r / spread, CORE_NAMES[i % len(CORE_NAMES)])

        # 2. Inner districts — area-uniform disc, every bearing covered
        for i in range(n_inner):
            r = spread * math.sqrt(rng.uniform(0.02, 0.36))  # 0.14..0.6 * spread
            bearing = rng.uniform(0.0, 2 * math.pi)
            place(r, bearing, 0.0, _district_name(bearing, True),
                  r / spread, INNER_NAMES[(n_core + i) % len(INNER_NAMES)])

        # 3. Satellite hubs — subcentres spread around the ring road
        k_hubs = max(1, min(config.num_clusters, n_hubs if n_hubs > 0 else 1))
        hub_bearings = [2 * math.pi * h / k_hubs + rng.uniform(-0.3, 0.3) for h in range(k_hubs)]
        hub_dists = [rng.uniform(0.55, 0.80) * spread for _ in range(k_hubs)]
        for i in range(n_hubs):
            h = i % k_hubs
            bearing, dist = hub_bearings[h], hub_dists[h]
            place(dist, bearing, 0.10 * spread, f"{HUB_NAMES[h % len(HUB_NAMES)]} Hub",
                  dist / spread, HUB_NAMES[(n_core + n_inner + i) % len(HUB_NAMES)])

        # 4. Outskirts — sparse fringe ring, lowest orders
        for i in range(n_fringe):
            r = rng.uniform(0.65, 1.0) * spread
            bearing = rng.uniform(0.0, 2 * math.pi)
            place(r, bearing, 0.0, _district_name(bearing, False),
                  r / spread, FRINGE_NAMES[i % len(FRINGE_NAMES)])

        # 5. Guarantee: anchor nodes within sight of the city centre
        anchors = min(3, len(lats))
        for a in range(anchors):
            r = rng.uniform(0.02, 0.08) * spread
            bearing = rng.uniform(0.0, 2 * math.pi)
            lats[a] = config.lat_center + r * math.cos(bearing) * lat_deg_per_km
            lons[a] = config.lon_center + r * math.sin(bearing) * lon_deg_per_km
            zones[a] = "City Centre"
            fracs[a] = r / spread
            name_pool[a] = CORE_NAMES[a % len(CORE_NAMES)]

    # Order volumes taper with distance from the centre (dense core orders most)
    orders = [_orders_for(rng, f, config.orders_min, config.orders_max) for f in fracs]

    # Assemble canonical neighborhood records (suffixed only when names repeat)
    from collections import Counter
    name_totals = Counter(name_pool)
    name_seen: Dict[str, int] = {}
    nodes: List[Dict[str, Any]] = []
    for i in range(config.N):
        nid = f"N{i+1:03d}" if config.N < 1000 else f"N{i+1:04d}"
        base = name_pool[i]
        if name_totals[base] > 1:
            name_seen[base] = name_seen.get(base, 0) + 1
            name = f"{base} #{name_seen[base]}"
        else:
            name = base

        # Clamp lat and lon within valid geographic bounds
        lat_val = round(float(np.clip(lats[i], -89.9, 89.9)), 6)
        lon_val = round(float(np.clip(lons[i], -179.9, 179.9)), 6)

        nodes.append({
            "neighborhood_id": nid,
            "name": name,
            "latitude": lat_val,
            "longitude": lon_val,
            "daily_orders": int(orders[i]),
            "zone": zones[i]
        })

    return nodes
