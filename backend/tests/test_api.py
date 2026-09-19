"""Tests for FastAPI backend endpoints."""
import json
import pytest
from fastapi.testclient import TestClient
from src.api import app

client = TestClient(app)


def test_health_endpoint():
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_synthetic_endpoint():
    response = client.get("/api/synthetic?N=15&seed=42&distribution=clustered")
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 15
    assert "neighborhood_id" in data[0]
    assert "daily_orders" in data[0]


def test_validate_endpoint():
    payload = {
        "neighborhoods": [
            {"neighborhood_id": "N1", "latitude": 17.385, "longitude": 78.486, "daily_orders": 100},
            {"neighborhood_id": "N2", "latitude": 17.400, "longitude": 78.500, "daily_orders": 200}
        ]
    }
    response = client.post("/api/validate", json=payload)
    assert response.status_code == 200
    res_json = response.json()
    assert res_json["valid"] is True
    assert res_json["total_rows"] == 2


def test_upload_csv_endpoint():
    csv_bytes = b"neighborhood_id,latitude,longitude,daily_orders\nN1,17.385,78.486,100\n"
    response = client.post(
        "/api/upload",
        files={"file": ("test.csv", csv_bytes, "text/csv")}
    )
    assert response.status_code == 200
    data = response.json()
    assert data["validation"]["valid"] is True
    assert len(data["neighborhoods"]) == 1
    assert data["summary"]["count"] == 1


def test_upload_with_errors():
    csv_bytes = b"neighborhood_id,latitude,longitude,daily_orders\nN1,95.0,78.486,-10\n"
    response = client.post(
        "/api/upload",
        files={"file": ("bad.csv", csv_bytes, "text/csv")}
    )
    assert response.status_code == 200
    data = response.json()
    assert data["validation"]["valid"] is False
    assert len(data["validation"]["errors"]) > 0


def test_export_endpoints():
    payload = {
        "neighborhoods": [
            {"neighborhood_id": "N1", "name": "Hub", "latitude": 17.385, "longitude": 78.486, "daily_orders": 120}
        ]
    }
    csv_resp = client.post("/api/export/csv", json=payload)
    assert csv_resp.status_code == 200
    assert "N1,Hub,17.385,78.486,120" in csv_resp.text

    json_resp = client.post("/api/export/json", json=payload)
    assert json_resp.status_code == 200
    parsed = json.loads(json_resp.text)
    assert parsed[0]["neighborhood_id"] == "N1"


def test_scenario_endpoints():
    nodes = [
        {"neighborhood_id": "N1", "latitude": 17.385, "longitude": 78.486, "daily_orders": 100},
        {"neighborhood_id": "N2", "latitude": 17.440, "longitude": 78.380, "daily_orders": 200},
    ]

    # 1. Tradeoff
    resp = client.post("/api/scenarios/tradeoff", json={
        "neighborhoods": nodes,
        "config": {"K": 2, "infra_cost_per_warehouse": 300.0},
        "max_k": 2
    })
    assert resp.status_code == 200
    data = resp.json()
    assert "optimal_K" in data
    assert len(data["points"]) == 2

    # 2. Demand shift
    resp = client.post("/api/scenarios/demand-shift", json={
        "neighborhoods": nodes,
        "pct_delta": 25.0
    })
    assert resp.status_code == 200
    assert resp.json()["stats"]["new_total_orders"] == 375 # (100*1.25) + (200*1.25) = 125 + 250

