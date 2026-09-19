"""
GridPoint Distance Engine
Vectorized distance matrices for Haversine, Euclidean, and Manhattan metrics (schema.md §5).
"""
import numpy as np

EARTH_RADIUS_KM = 6371.0088  # WGS84 mean radius
KM_PER_DEGREE = 111.0  # Approx km per degree on sphere


def haversine_distance_matrix(coords1: np.ndarray, coords2: np.ndarray) -> np.ndarray:
    """
    Computes NxM pairwise Haversine distances in kilometers.
    coords1: (N, 2) array of [latitude, longitude] in decimal degrees.
    coords2: (M, 2) array of [latitude, longitude] in decimal degrees.
    Returns: (N, M) matrix of great-circle distances in km.
    """
    c1 = np.atleast_2d(coords1)
    c2 = np.atleast_2d(coords2)

    if c1.shape[0] == 0 or c2.shape[0] == 0:
        return np.empty((c1.shape[0], c2.shape[0]), dtype=np.float64)

    # Convert degrees to radians
    lat1_rad = np.radians(c1[:, 0])[:, np.newaxis]  # (N, 1)
    lon1_rad = np.radians(c1[:, 1])[:, np.newaxis]  # (N, 1)
    lat2_rad = np.radians(c2[:, 0])[np.newaxis, :]  # (1, M)
    lon2_rad = np.radians(c2[:, 1])[np.newaxis, :]  # (1, M)

    dlat = lat2_rad - lat1_rad  # (N, M)
    dlon = lon2_rad - lon1_rad  # (N, M)

    # Haversine formula
    sin_dlat = np.sin(dlat / 2.0)
    sin_dlon = np.sin(dlon / 2.0)

    a = (sin_dlat ** 2) + np.cos(lat1_rad) * np.cos(lat2_rad) * (sin_dlon ** 2)
    # Clip for numerical stability within [-1.0, 1.0]
    a_clipped = np.clip(a, 0.0, 1.0)
    c = 2.0 * np.arcsin(np.sqrt(a_clipped))

    return EARTH_RADIUS_KM * c


def euclidean_distance_matrix(coords1: np.ndarray, coords2: np.ndarray) -> np.ndarray:
    """
    Computes NxM equirectangular planar Euclidean approximation in kilometers (schema.md §5).
    Accounts for latitude cosine scaling for longitude.
    """
    c1 = np.atleast_2d(coords1)
    c2 = np.atleast_2d(coords2)

    if c1.shape[0] == 0 or c2.shape[0] == 0:
        return np.empty((c1.shape[0], c2.shape[0]), dtype=np.float64)

    lat1 = c1[:, 0][:, np.newaxis]
    lon1 = c1[:, 1][:, np.newaxis]
    lat2 = c2[:, 0][np.newaxis, :]
    lon2 = c2[:, 1][np.newaxis, :]

    lat_avg_rad = np.radians((lat1 + lat2) / 2.0)
    cos_lat = np.cos(lat_avg_rad)

    dlat_km = (lat1 - lat2) * KM_PER_DEGREE
    dlon_km = (lon1 - lon2) * cos_lat * KM_PER_DEGREE

    return np.sqrt(dlat_km ** 2 + dlon_km ** 2)


def manhattan_distance_matrix(coords1: np.ndarray, coords2: np.ndarray) -> np.ndarray:
    """
    Computes NxM Manhattan (L1 / city-block) distance in kilometers (schema.md §5).
    """
    c1 = np.atleast_2d(coords1)
    c2 = np.atleast_2d(coords2)

    if c1.shape[0] == 0 or c2.shape[0] == 0:
        return np.empty((c1.shape[0], c2.shape[0]), dtype=np.float64)

    lat1 = c1[:, 0][:, np.newaxis]
    lon1 = c1[:, 1][:, np.newaxis]
    lat2 = c2[:, 0][np.newaxis, :]
    lon2 = c2[:, 1][np.newaxis, :]

    lat_avg_rad = np.radians((lat1 + lat2) / 2.0)
    cos_lat = np.cos(lat_avg_rad)

    dlat_km = np.abs(lat1 - lat2) * KM_PER_DEGREE
    dlon_km = np.abs(lon1 - lon2) * cos_lat * KM_PER_DEGREE

    return dlat_km + dlon_km


def compute_distance_matrix(
    coords1: np.ndarray,
    coords2: np.ndarray,
    metric: str = "haversine"
) -> np.ndarray:
    """
    Universal distance dispatcher.
    metric: 'haversine' | 'euclidean' | 'manhattan'
    """
    clean_metric = metric.lower().strip()
    if clean_metric == "euclidean":
        return euclidean_distance_matrix(coords1, coords2)
    elif clean_metric == "manhattan":
        return manhattan_distance_matrix(coords1, coords2)
    else:
        # Default to Haversine
        return haversine_distance_matrix(coords1, coords2)
