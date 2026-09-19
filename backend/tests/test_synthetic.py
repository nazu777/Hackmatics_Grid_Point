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
