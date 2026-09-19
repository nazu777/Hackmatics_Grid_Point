"""Tests for synthetic dataset generator."""
from src.schema import SyntheticGenerationConfig
from src.synthetic import generate_synthetic_dataset
from src.validation import validate_neighborhoods


def test_generate_clustered():
    config = SyntheticGenerationConfig(N=30, num_clusters=3, seed=42)
    nodes = generate_synthetic_dataset(config)
    assert len(nodes) == 30
    val, clean = validate_neighborhoods(nodes)
    assert val.valid is True
    assert len(clean) == 30


def test_generate_uniform():
    config = SyntheticGenerationConfig(N=20, distribution="uniform", seed=99)
    nodes = generate_synthetic_dataset(config)
    assert len(nodes) == 20
    val, clean = validate_neighborhoods(nodes)
    assert val.valid is True


def test_seed_determinism():
    c1 = SyntheticGenerationConfig(N=25, seed=123)
    c2 = SyntheticGenerationConfig(N=25, seed=123)
    nodes1 = generate_synthetic_dataset(c1)
    nodes2 = generate_synthetic_dataset(c2)
    assert nodes1 == nodes2


def _km(n, lat_c=17.385044, lon_c=78.486671):
    import math
    dlat = (n["latitude"] - lat_c) * 110.574
    dlon = (n["longitude"] - lon_c) * 111.320 * math.cos(math.radians(lat_c))
    return math.hypot(dlat, dlon)


def test_clustered_covers_centre_and_full_spread():
    """City model must populate the centre AND reach the spread edge."""
    config = SyntheticGenerationConfig(N=60, num_clusters=3, spread_km=20.0, seed=42)
    nodes = generate_synthetic_dataset(config)
    dists = sorted(_km(n) for n in nodes)
    assert dists[0] < 0.1 * config.spread_km, "city centre must be populated"
    assert dists[-1] > 0.5 * config.spread_km, "generation must reach the spread edge"
    assert any(n["zone"] == "City Centre" for n in nodes)


def test_clustered_orders_taper_with_distance():
    """Realism: dense core orders more than the fringe on average."""
    import statistics
    config = SyntheticGenerationConfig(N=80, num_clusters=3, spread_km=20.0,
                                       orders_min=10, orders_max=200, seed=7)
    nodes = generate_synthetic_dataset(config)
    near = [n["daily_orders"] for n in nodes if _km(n) < 5]
    far = [n["daily_orders"] for n in nodes if _km(n) > 12]
    assert len(near) > 0 and len(far) > 0
    assert statistics.mean(near) > statistics.mean(far)
