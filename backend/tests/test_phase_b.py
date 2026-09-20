"""Phase B tests: {frm|from} contract, coverage heatmap, warehouse focus, traffic summary."""
from fastapi.testclient import TestClient
from src.api import app
from src.mapping import (
    coverage_heatmap,
    corridor_traffic_summary,
    proximity_color,
    warehouse_focus_summary,
)

client = TestClient(app)

NBS = [
    {"neighborhood_id": "N1", "name": "A", "latitude": 17.38, "longitude": 78.48, "daily_orders": 100},
    {"neighborhood_id": "N2", "name": "B", "latitude": 17.44, "longitude": 78.38, "daily_orders": 200},
]
WHS = [{"warehouse_id": "W1", "latitude": 17.40, "longitude": 78.45, "capacity": 500}]
ASG = [
    {"neighborhood_id": "N1", "warehouse_id": "W1", "distance_km": 5.0,
     "within_radius": True, "is_feasible": True, "congestion_pct": 0.1},
    {"neighborhood_id": "N2", "warehouse_id": "W1", "distance_km": 15.0,
     "within_radius": True, "is_feasible": True, "congestion_pct": 0.5},
]


def test_routes_accepts_from_spelling():
    r = client.post("/api/routes/geometry", json={
        "pairs": [{"from": {"lat": 17.38, "lon": 78.48}, "to": {"lat": 17.44, "lon": 78.38}}]})
    assert r.status_code == 200
    assert isinstance(r.json()["routes"], list)


def test_routes_accepts_frm_spelling():
    r = client.post("/api/routes/geometry", json={
        "pairs": [{"frm": {"lat": 17.38, "lon": 78.48}, "to": {"lat": 17.44, "lon": 78.38}}]})
    assert r.status_code == 200
    assert isinstance(r.json()["routes"], list)


def test_routes_rejects_garbage_without_raw_pair_leak():
    # Missing 'to' still 400s, but the message names the accepted contract.
    r = client.post("/api/routes/geometry", json={
        "pairs": [{"from": {"lat": 17.38, "lon": 78.48}}]})
    assert r.status_code == 400
    assert "frm|from" in r.json()["detail"]


def test_proximity_color_ramps_green_to_red():
    assert proximity_color(0.0) == "#22c55e"
    assert proximity_color(0.5) == "#f59e0b"
    assert proximity_color(1.0) == "#ef4444"


def test_coverage_heatmap_cells_and_range():
    grid = coverage_heatmap(NBS, ASG, grid_n=6)
    assert len(grid["cells"]) == 36
    assert grid["min_km"] == 5.0
    assert grid["max_km"] == 15.0
    assert all(c["color"].startswith("#") for c in grid["cells"])
    hot = coverage_heatmap(NBS, ASG, grid_n=6, top_k=1)
    assert hot["hotspots"][0]["neighborhood_id"] == "N2"


def test_coverage_heatmap_covers_full_padded_area():
    # City-wide: padded bounds must extend beyond the raw node extents and
    # ship the geometry clients need for continuous zone polygons.
    grid = coverage_heatmap(NBS, ASG, grid_n=6)
    b = grid["bounds"]
    assert b["min_lat"] < 17.38 and b["max_lat"] > 17.44
    assert b["min_lon"] < 78.38 and b["max_lon"] > 78.48
    assert grid["cell_step"]["dlat"] > 0 and grid["cell_step"]["dlon"] > 0
    assert abs(grid["cell_step"]["dlat"] - (b["max_lat"] - b["min_lat"]) / 6) < 1e-5
    # Zero-pad keeps the legacy tight-bounds behavior for API compat.
    tight = coverage_heatmap(NBS, ASG, grid_n=6, pad=0.0)
    assert tight["bounds"]["min_lat"] < 17.38  # minimum 0.02° margin still applies


def test_warehouse_focus_aggregates_orders_and_members():
    f = warehouse_focus_summary("W1", NBS, WHS, ASG)
    assert f["found"] is True
    assert f["assigned_orders"] == 300  # Σ daily_orders
    assert f["neighborhood_count"] == 2
    assert f["utilization_pct"] == 60.0
    assert [m["neighborhood_id"] for m in f["members"]] == ["N1", "N2"]  # sorted by distance
    assert f["members"][0]["daily_orders"] == 100
    assert f["members"][1]["distance_km"] == 15.0


def test_warehouse_focus_unknown_id():
    assert warehouse_focus_summary("W9", NBS, WHS, ASG)["found"] is False


def test_corridor_traffic_buckets():
    s = corridor_traffic_summary(ASG)
    assert s["buckets"] == {"fluid": 1, "busy": 0, "jammed": 1, "unknown": 0}
    assert s["by_warehouse"]["W1"]["fluid"] == 1
    assert s["avg_congestion_pct"] == 0.3


def test_map_coverage_endpoint():
    r = client.post("/api/map/coverage", json={
        "neighborhoods": NBS, "assignments": ASG, "grid_n": 6})
    assert r.status_code == 200
    assert len(r.json()["cells"]) == 36


def test_map_warehouse_focus_endpoint():
    r = client.post("/api/map/warehouse-focus", json={
        "warehouse_id": "W1", "neighborhoods": NBS,
        "warehouses": WHS, "assignments": ASG})
    assert r.status_code == 200
    assert r.json()["assigned_orders"] == 300


def test_map_summary_extended_with_result():
    r = client.post("/api/map/summary", json={
        "neighborhoods": NBS, "warehouses": WHS, "assignments": ASG})
    assert r.status_code == 200
    body = r.json()
    assert "coverage" in body and "traffic" in body and "focus" in body
    assert body["focus"]["W1"]["assigned_orders"] == 300


def test_map_summary_backward_compatible():
    r = client.post("/api/map/summary", json={"neighborhoods": NBS})
    assert r.status_code == 200
    assert "nodes" in r.json()
