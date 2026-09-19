"""Tests for CSV/JSON data ingestion and export."""
import json
import pytest
from src.data_ingestion import (
    parse_csv_content,
    parse_json_content,
    export_to_csv,
    export_to_json,
    compute_dataset_summary
)


def test_parse_csv_standard():
    csv_text = """neighborhood_id,name,latitude,longitude,daily_orders
N1,Downtown,17.385,78.486,150
N2,Uptown,17.400,78.500,80
"""
    val, nodes = parse_csv_content(csv_text)
    assert val.valid is True
    assert len(nodes) == 2
    assert nodes[0]["neighborhood_id"] == "N1"
    assert nodes[0]["daily_orders"] == 150


def test_parse_csv_aliases():
    # Test alias mapping: id -> neighborhood_id, lat -> latitude, lon -> longitude, orders -> daily_orders
    csv_text = """id,lat,lon,orders
N10,12.93,77.62,250
N20,12.97,77.64,180
"""
    val, nodes = parse_csv_content(csv_text)
    assert val.valid is True
    assert len(nodes) == 2
    assert nodes[0]["neighborhood_id"] == "N10"
    assert nodes[0]["latitude"] == 12.93
    assert nodes[0]["longitude"] == 77.62
    assert nodes[0]["daily_orders"] == 250


def test_parse_json_array():
    json_text = json.dumps([
        {"neighborhood_id": "N1", "latitude": 17.385, "longitude": 78.486, "daily_orders": 100},
        {"neighborhood_id": "N2", "latitude": 17.400, "longitude": 78.500, "daily_orders": 200}
    ])
    val, nodes = parse_json_content(json_text)
    assert val.valid is True
    assert len(nodes) == 2


def test_parse_json_wrapped():
    json_text = json.dumps({
        "neighborhoods": [
            {"neighborhood_id": "N1", "latitude": 17.385, "longitude": 78.486, "daily_orders": 100}
        ]
    })
    val, nodes = parse_json_content(json_text)
    assert val.valid is True
    assert len(nodes) == 1
    assert nodes[0]["neighborhood_id"] == "N1"


def test_export_and_summary():
    nodes = [
        {"neighborhood_id": "N1", "name": "Node 1", "latitude": 10.0, "longitude": 20.0, "daily_orders": 100},
        {"neighborhood_id": "N2", "name": "Node 2", "latitude": 12.0, "longitude": 22.0, "daily_orders": 200}
    ]
    summary = compute_dataset_summary(nodes)
    assert summary["count"] == 2
    assert summary["total_orders"] == 300
    assert summary["avg_orders"] == 150.0

    csv_out = export_to_csv(nodes)
    assert "neighborhood_id,name,latitude,longitude,daily_orders" in csv_out
    assert "N1,Node 1,10.0,20.0,100" in csv_out

    json_out = export_to_json(nodes)
    loaded = json.loads(json_out)
    assert len(loaded) == 2
