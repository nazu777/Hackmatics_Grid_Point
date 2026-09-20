"""Tests for imported-assignment ingest, validation, and workspace persistence."""
import io
import pytest
from fastapi.testclient import TestClient
from src.api import app
from src import auth as auth_module
from src import userdata as userdata_module
from src.data_ingestion import (
    compute_assignment_summary,
    parse_assignments_csv,
    parse_assignments_json,
)
from src.validation import validate_assignments

client = TestClient(app)

CSV = "neighborhood_id,warehouse_id,distance_km\nN1,W1,5.0\nN2,W1,7.5\n"
CSV_ALIASED = "node,warehouse,dist\nN1,W1,5.0\n"
JSON_ROWS = [{"neighborhood_id": "N1", "warehouse_id": "W1"},
             {"node": "N2", "warehouse": "W2"}]


def test_validate_assignments_ok_and_clean():
    res, clean = validate_assignments(
        [{"neighborhood_id": "N1", "warehouse_id": "W1", "distance_km": 5.0}],
        ["N1"], ["W1"])
    assert res.valid and res.errors == [] and res.warnings == []
    assert clean == [{"neighborhood_id": "N1", "warehouse_id": "W1", "distance_km": 5.0}]


def test_validate_assignments_errors_and_unknown_warnings():
    res, _ = validate_assignments([{"neighborhood_id": "", "warehouse_id": "W1"}])
    assert not res.valid
    assert any(e.code == "NULL_OR_EMPTY" for e in res.errors)

    dup = validate_assignments(
        [{"neighborhood_id": "N1", "warehouse_id": "W1"},
         {"neighborhood_id": "N1", "warehouse_id": "W2"}])[0]
    assert not dup.valid
    assert any(e.code == "DUPLICATE_ID" for e in dup.errors)

    res2, clean2 = validate_assignments(
        [{"neighborhood_id": "NX", "warehouse_id": "WX"}],
        known_neighborhoods=["N1"], known_warehouses=["W1"])
    assert res2.valid  # warnings only
    assert len(res2.warnings) == 2
    assert all(w.code == "UNKNOWN_REFERENCE" for w in res2.warnings)
    assert clean2[0]["distance_km"] is None

    empty = validate_assignments([])[0]
    assert not empty.valid


def test_parse_assignments_csv_and_aliases():
    res, clean = parse_assignments_csv(CSV)
    assert res.valid and len(clean) == 2
    assert clean[0] == {"neighborhood_id": "N1", "warehouse_id": "W1", "distance_km": 5.0}
    res2, clean2 = parse_assignments_csv(CSV_ALIASED)
    assert res2.valid and clean2[0]["neighborhood_id"] == "N1"
    bad, _ = parse_assignments_csv("foo,bar\n1,2\n")
    assert not bad.valid
    assert compute_assignment_summary(clean) == {
        "count": 2, "warehouses_used": 1, "per_warehouse": {"W1": 2}}


def test_parse_assignments_json_wrappers():
    res, clean = parse_assignments_json('[{"neighborhood_id": "N1", "warehouse_id": "W1"}]')
    assert res.valid and len(clean) == 1
    res2, clean2 = parse_assignments_json('{"assignments": []}')
    assert not res2.valid  # empty dataset
    res3, _ = parse_assignments_json('{"nope": 1}')
    assert not res3.valid


def test_upload_dataset_assignments():
    files = {"file": ("plan.csv", io.BytesIO(CSV.encode()), "text/csv")}
    r = client.post("/api/upload?dataset=assignments", files=files)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["dataset"] == "assignments"
    assert len(body["assignments"]) == 2
    assert body["summary"]["count"] == 2


def test_assignments_validate_endpoint():
    r = client.post("/api/assignments/validate", json={
        "assignments": [{"neighborhood_id": "N1", "warehouse_id": "W9"}],
        "neighborhoods": [{"neighborhood_id": "N1"}],
        "warehouses": [{"warehouse_id": "W1"}]})
    assert r.status_code == 200
    body = r.json()
    assert body["valid"] is True
    assert len(body["warnings"]) == 1  # unknown W9


@pytest.fixture(autouse=True)
def _isolated_stores(tmp_path, monkeypatch):
    monkeypatch.setenv("GRIDPOINT_USERS_FILE", str(tmp_path / "users.json"))
    monkeypatch.setenv("GRIDPOINT_DATA_FILE", str(tmp_path / "user_data.json"))
    auth_module.clear_users()
    userdata_module.clear_workspaces()
    yield
    auth_module.clear_users()
    userdata_module.clear_workspaces()


def test_userdata_assignments_roundtrip():
    r = client.post("/api/auth/signup", json={
        "name": "A", "email": "a@example.com", "password": "password123"})
    token = r.json()["token"]
    h = {"Authorization": f"Bearer {token}"}
    rows = [{"neighborhood_id": "N1", "warehouse_id": "W1"}]
    put = client.put("/api/user/data", headers=h, json={"assignments": rows})
    assert put.status_code == 200
    got = client.get("/api/user/data", headers=h).json()
    assert got["assignments"] == rows
