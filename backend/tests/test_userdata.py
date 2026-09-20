"""Tests for server-side per-user workspace persistence (/api/user/data)."""
import pytest
from fastapi.testclient import TestClient
from src.api import app
from src import auth as auth_module
from src import userdata as userdata_module

client = TestClient(app)

WS = {
    "neighborhoods": [
        {"neighborhood_id": "N1", "name": "A", "latitude": 17.38,
         "longitude": 78.48, "daily_orders": 100}
    ],
    "vehicles": [{"vehicle_id": "V1", "type": "truck", "capacity": 200}],
    "warehouses": [{"warehouse_id": "W9", "latitude": 17.40, "longitude": 78.45}],
    "config": {"K": 2, "distance_metric": "haversine"},
    "updated_at": 1234.0,
}


@pytest.fixture(autouse=True)
def _isolated_stores(tmp_path, monkeypatch):
    monkeypatch.setenv("GRIDPOINT_USERS_FILE", str(tmp_path / "users.json"))
    monkeypatch.setenv("GRIDPOINT_DATA_FILE", str(tmp_path / "user_data.json"))
    auth_module.clear_users()
    userdata_module.clear_workspaces()
    yield
    auth_module.clear_users()
    userdata_module.clear_workspaces()


def _signup_token(email="ws@example.com"):
    r = client.post("/api/auth/signup", json={
        "name": "WS", "email": email, "password": "password123"})
    assert r.status_code == 200, r.text
    return r.json()["token"]


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


def test_user_data_empty_then_roundtrip():
    token = _signup_token()
    empty = client.get("/api/user/data", headers=_auth(token))
    assert empty.status_code == 200
    assert empty.json()["neighborhoods"] == []
    assert empty.json()["warehouses"] == []

    put = client.put("/api/user/data", headers=_auth(token), json=WS)
    assert put.status_code == 200, put.text
    assert put.json()["saved"] is True

    got = client.get("/api/user/data", headers=_auth(token))
    assert got.status_code == 200
    body = got.json()
    assert body["neighborhoods"][0]["neighborhood_id"] == "N1"
    assert body["vehicles"][0]["vehicle_id"] == "V1"
    assert body["warehouses"][0]["warehouse_id"] == "W9"
    assert body["config"]["K"] == 2
    assert body["updated_at"] == 1234.0


def test_user_data_requires_auth():
    assert client.get("/api/user/data").status_code == 401
    assert client.put("/api/user/data", json=WS).status_code == 401
    bad = {"Authorization": "Bearer invalid.token.here"}
    assert client.get("/api/user/data", headers=bad).status_code == 401


def test_user_data_isolated_per_user():
    t1 = _signup_token("one@example.com")
    t2 = _signup_token("two@example.com")
    client.put("/api/user/data", headers=_auth(t1), json=WS)
    other = client.get("/api/user/data", headers=_auth(t2))
    assert other.json()["neighborhoods"] == []
    assert other.json()["warehouses"] == []


def test_user_data_partial_merge_and_validation():
    token = _signup_token()
    client.put("/api/user/data", headers=_auth(token), json=WS)
    # Partial update merges: only warehouses replaced.
    r = client.put("/api/user/data", headers=_auth(token), json={
        "warehouses": [{"warehouse_id": "W2", "latitude": 1.0, "longitude": 2.0}]})
    assert r.status_code == 200
    body = client.get("/api/user/data", headers=_auth(token)).json()
    assert [w["warehouse_id"] for w in body["warehouses"]] == ["W2"]
    assert body["neighborhoods"][0]["neighborhood_id"] == "N1"  # kept
    # Invalid payloads rejected (wrong type → 422; over cap → 400).
    bad = client.put("/api/user/data", headers=_auth(token),
                     json={"neighborhoods": "not-a-list"})
    assert bad.status_code in (400, 422)
    too_big = client.put("/api/user/data", headers=_auth(token), json={
        "neighborhoods": [{"neighborhood_id": f"N{i}"} for i in range(5001)]})
    assert too_big.status_code == 400


def test_user_data_survives_backend_restart(tmp_path, monkeypatch):
    store = tmp_path / "restart_data.json"
    monkeypatch.setenv("GRIDPOINT_DATA_FILE", str(store))
    userdata_module.clear_workspaces()
    token = _signup_token("restart-data@example.com")
    assert client.put("/api/user/data", headers=_auth(token), json=WS).status_code == 200
    assert store.is_file()

    # Simulate restart: drop memory only.
    userdata_module._WORKSPACES.clear()
    userdata_module._LOADED_FROM = None

    body = client.get("/api/user/data", headers=_auth(token)).json()
    assert body["warehouses"][0]["warehouse_id"] == "W9"
    assert body["vehicles"][0]["vehicle_id"] == "V1"
