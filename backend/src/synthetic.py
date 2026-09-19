"""
GridPoint Synthetic Dataset Generator
Generates realistic, seedable spatial demand distributions (schema.md §2.8).
"""
import math
from typing import List, Dict, Any
import numpy as np
from .schema import SyntheticGenerationConfig

# Real city landmark names for realistic synthetic labels
LOCALITY_NAMES = [
    "Downtown", "Market Central", "Tech Park", "Cyber City", "Financial District",
    "Old Quarter", "Harbor View", "Green Hills", "North Gateway", "South Port",
    "East End", "West Industrial", "Riverside", "Lakeview", "Metro Hub",
    "Airport Road", "Grand Square", "Innovation Zone", "Sunrise Colony", "Midtown"
]


def generate_synthetic_dataset(config: SyntheticGenerationConfig) -> List[Dict[str, Any]]:
    """
    Generates a synthetic list of neighborhoods according to the specified configuration.
    Uses seedable NumPy random state for deterministic reproducibility.
    """
    rng = np.random.default_rng(config.seed)

    # 1 degree latitude is approx 110.574 km
    lat_deg_per_km = 1.0 / 110.574
    # 1 degree longitude depends on latitude: 111.320 * cos(lat)
    rad_lat = math.radians(config.lat_center)
    lon_deg_per_km = 1.0 / (111.320 * max(0.1, math.cos(rad_lat)))

    max_lat_delta = config.spread_km * lat_deg_per_km
    max_lon_delta = config.spread_km * lon_deg_per_km

    nodes: List[Dict[str, Any]] = []

    if config.distribution == "uniform":
        lats = rng.uniform(
            config.lat_center - max_lat_delta,
            config.lat_center + max_lat_delta,
            config.N
        )
        lons = rng.uniform(
            config.lon_center - max_lon_delta,
            config.lon_center + max_lon_delta,
            config.N
        )
        zones = ["Zone-A" for _ in range(config.N)]

    elif config.distribution == "gaussian":
        # Centered around (lat_center, lon_center) with standard deviation spread_km / 3
        std_lat = (config.spread_km / 3.0) * lat_deg_per_km
        std_lon = (config.spread_km / 3.0) * lon_deg_per_km
        lats = rng.normal(config.lat_center, std_lat, config.N)
        lons = rng.normal(config.lon_center, std_lon, config.N)
        zones = ["Central-Zone" for _ in range(config.N)]

    else:  # "clustered" (default)
        k_clusters = min(config.num_clusters, config.N)
        # Generate cluster centers within the bounding area
        cluster_lats = rng.uniform(
            config.lat_center - 0.7 * max_lat_delta,
            config.lat_center + 0.7 * max_lat_delta,
            k_clusters
        )
        cluster_lons = rng.uniform(
            config.lon_center - 0.7 * max_lon_delta,
            config.lon_center + 0.7 * max_lon_delta,
            k_clusters
        )

        cluster_std_lat = (max_lat_delta / (k_clusters * 1.5))
        cluster_std_lon = (max_lon_delta / (k_clusters * 1.5))

        lats = []
        lons = []
        zones = []

        # Distribute points across clusters with some noise
        for i in range(config.N):
            c_idx = i % k_clusters
            c_lat = rng.normal(cluster_lats[c_idx], cluster_std_lat)
            c_lon = rng.normal(cluster_lons[c_idx], cluster_std_lon)
            lats.append(c_lat)
            lons.append(c_lon)
            zones.append(f"Cluster-{c_idx + 1}")

    # Generate daily order volumes (weights)
    orders = rng.integers(config.orders_min, config.orders_max + 1, size=config.N)

    # Assemble canonical neighborhood records
    for i in range(config.N):
        nid = f"N{i+1:03d}" if config.N < 1000 else f"N{i+1:04d}"
        locality = LOCALITY_NAMES[i % len(LOCALITY_NAMES)]
        name = f"{locality} #{i+1}" if config.N > len(LOCALITY_NAMES) else locality

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
