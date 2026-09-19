"""Tests for GridPoint validation rules (schema.md §4)."""
import pytest
from src.validation import validate_neighborhoods, validate_neighborhood_row, validate_optimization_config
from src.schema import OptimizationConfig


def test_valid_neighborhoods():
    data = [
        {"neighborhood_id": "N001", "latitude": 17.385, "longitude": 78.486, "daily_orders": 100},
        {"neighborhood_id": "N002", "latitude": 17.400, "longitude": 78.500, "daily_orders": 200},
    ]
    val, clean = validate_neighborhoods(data)
    assert val.valid is True
    assert len(val.errors) == 0
    assert len(clean) == 2
    assert clean[0]["daily_orders"] == 100


def test_empty_dataset_validation():
    val, clean = validate_neighborhoods([])
    assert val.valid is False
    assert any(e.code == "EMPTY_DATASET" for e in val.errors)


def test_latitude_out_of_range():
    data = [{"neighborhood_id": "N001", "latitude": 120.5, "longitude": 78.486, "daily_orders": 100}]
    val, clean = validate_neighborhoods(data)
    assert val.valid is False
    assert any(e.code == "OUT_OF_RANGE" and e.field == "latitude" for e in val.errors)


def test_longitude_out_of_range():
    data = [{"neighborhood_id": "N001", "latitude": 17.385, "longitude": -195.0, "daily_orders": 100}]
    val, clean = validate_neighborhoods(data)
    assert val.valid is False
    assert any(e.code == "OUT_OF_RANGE" and e.field == "longitude" for e in val.errors)


def test_negative_orders():
    data = [{"neighborhood_id": "N001", "latitude": 17.385, "longitude": 78.486, "daily_orders": -5}]
    val, clean = validate_neighborhoods(data)
    assert val.valid is False
    assert any(e.code == "OUT_OF_RANGE" and e.field == "daily_orders" for e in val.errors)


def test_duplicate_neighborhood_id():
    data = [
        {"neighborhood_id": "N001", "latitude": 17.385, "longitude": 78.486, "daily_orders": 100},
        {"neighborhood_id": "N001", "latitude": 17.400, "longitude": 78.500, "daily_orders": 150}
    ]
    val, clean = validate_neighborhoods(data)
    assert val.valid is False
    assert any(e.code == "DUPLICATE_ID" for e in val.errors)


def test_null_or_empty_id():
    data = [{"neighborhood_id": "", "latitude": 17.385, "longitude": 78.486, "daily_orders": 100}]
    val, clean = validate_neighborhoods(data)
    assert val.valid is False
    assert any(e.code == "NULL_OR_EMPTY" for e in val.errors)


def test_optimization_config_capacity_check():
    nodes = [
        {"neighborhood_id": "N1", "daily_orders": 500},
        {"neighborhood_id": "N2", "daily_orders": 600}
    ]
    # Total demand = 1100. If K=2 and C_max=400, total capacity = 800 < 1100 -> Infeasible!
    config = OptimizationConfig(K=2, capacity_enabled=True, C_max=400)
    is_valid, errors, warnings = validate_optimization_config(config, nodes)
    assert is_valid is False
    assert any(e.code == "TOTAL_CAPACITY_INSUFFICIENT" for e in errors)
