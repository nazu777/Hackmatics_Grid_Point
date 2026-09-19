"""Unit tests for Phase 2 spatial mapping module."""
import pytest
from src.mapping import compute_map_bounds, compute_bubble_style, prepare_map_layer_data


def test_compute_map_bounds_empty():
    res = compute_map_bounds([])
    assert "center" in res
    assert "bounds" in res
    assert res["suggested_zoom"] >= 10


def test_compute_map_bounds_single_node():
    nodes = [{"neighborhood_id": "N1", "latitude": 17.385044, "longitude": 78.486671, "daily_orders": 100}]
    res = compute_map_bounds(nodes)
    assert res["center"]["lat"] == 17.385044
    assert res["center"]["lon"] == 78.486671
    # Check that a small bounding buffer was applied to prevent 0-dimension bounding box
    assert res["bounds"]["min_lat"] < 17.385044 < res["bounds"]["max_lat"]
    assert res["bounds"]["min_lon"] < 78.486671 < res["bounds"]["max_lon"]


def test_compute_map_bounds_hyderabad_spread():
    nodes = [
        {"neighborhood_id": "N1", "latitude": 17.36, "longitude": 78.47, "daily_orders": 100},
        {"neighborhood_id": "N2", "latitude": 17.45, "longitude": 78.38, "daily_orders": 300},
        {"neighborhood_id": "N3", "latitude": 17.49, "longitude": 78.50, "daily_orders": 150}
    ]
    res = compute_map_bounds(nodes)
    assert res["bounds"]["min_lat"] <= 17.36
    assert res["bounds"]["max_lat"] >= 17.49
    assert res["bounds"]["min_lon"] <= 78.38
    assert res["bounds"]["max_lon"] >= 78.50
    assert 17.36 <= res["center"]["lat"] <= 17.49
    assert res["span_km"] > 0


def test_compute_bubble_style():
    # Min order node
    style_min = compute_bubble_style(orders=10, min_orders=10, max_orders=200)
    assert style_min["radius_px"] == 6.0
    assert style_min["category"] == "Low"
    assert style_min["hex_color"] == "#10b981"

    # Max order node
    style_max = compute_bubble_style(orders=200, min_orders=10, max_orders=200)
    assert style_max["radius_px"] == 24.0
    assert style_max["category"] == "High"
    assert style_max["hex_color"] == "#ef4444"

    # Mid order node
    style_mid = compute_bubble_style(orders=105, min_orders=10, max_orders=200)
    assert 6.0 < style_mid["radius_px"] < 24.0
    assert style_mid["category"] in ["Medium", "High"]


def test_prepare_map_layer_data():
    nodes = [
        {"neighborhood_id": "N1", "latitude": 17.36, "longitude": 78.47, "daily_orders": 50},
        {"neighborhood_id": "N2", "latitude": 17.45, "longitude": 78.38, "daily_orders": 500}
    ]
    layer_data = prepare_map_layer_data(nodes)
    assert layer_data["total_nodes"] == 2
    assert layer_data["min_orders"] == 50
    assert layer_data["max_orders"] == 500
    assert len(layer_data["nodes"]) == 2
    assert "visual_radius" in layer_data["nodes"][0]
    assert "color_hex" in layer_data["nodes"][0]
    assert layer_data["nodes"][0]["visual_radius"] < layer_data["nodes"][1]["visual_radius"]
