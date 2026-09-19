"""Tests for GridPoint schema definitions."""
import pytest
from pydantic import ValidationError
from src.schema import Neighborhood, Warehouse, OptimizationConfig, SyntheticGenerationConfig


def test_neighborhood_valid():
    node = Neighborhood(
        neighborhood_id="N001",
        name="Downtown",
        latitude=17.385044,
        longitude=78.486671,
        daily_orders=120
    )
    assert node.neighborhood_id == "N001"
    assert node.latitude == 17.385044
    assert node.daily_orders == 120


def test_neighborhood_default_name():
    node = Neighborhood(
        neighborhood_id="N002",
        latitude=17.4,
        longitude=78.5,
        daily_orders=50
    )
    assert node.name == "N002"


def test_neighborhood_invalid_latitude():
    with pytest.raises(ValidationError):
        Neighborhood(
            neighborhood_id="N003",
            latitude=95.0,  # Invalid > 90
            longitude=78.5,
            daily_orders=50
        )


def test_neighborhood_negative_orders():
    with pytest.raises(ValidationError):
        Neighborhood(
            neighborhood_id="N004",
            latitude=17.4,
            longitude=78.5,
            daily_orders=-10  # Invalid < 0
        )


def test_synthetic_config_validation():
    with pytest.raises(ValueError):
        SyntheticGenerationConfig(orders_min=100, orders_max=50)
