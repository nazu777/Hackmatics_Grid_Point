"""Phase A — Onboarding Trio acceptance (backlog #4, #6, #8)."""
from src.validation import validate_vehicles, validate_warehouses, validate_neighborhoods
from src.data_ingestion import (parse_vehicles_csv, parse_vehicles_json,
                                parse_warehouses_csv, parse_warehouses_json)
from src.synthetic import generate_synthetic_vehicles, generate_synthetic_warehouses


def test_vehicle_validation_out_of_range_and_duplicate():
    bad = [
        {"vehicle_type": "van", "capacity": -5, "cost_per_km": 10.0},
        {"vehicle_type": "van", "capacity": 100, "cost_per_km": 10.0},
    ]
    val, _ = validate_vehicles(bad)
    assert not val.valid
    assert any(e.code == "OUT_OF_RANGE" for e in val.errors)
    assert any(e.code == "DUPLICATE_ID" for e in val.errors)


def test_warehouse_validation_out_of_range_and_duplicate():
    bad = [
        {"warehouse_id": "EX-W1", "latitude": 120.5, "longitude": 78.0},
        {"warehouse_id": "EX-W1", "latitude": 17.0, "longitude": 78.0},
    ]
    val, _ = validate_warehouses(bad)
    assert not val.valid
    assert any(e.code == "OUT_OF_RANGE" and e.field == "latitude" for e in val.errors)
    assert any(e.code == "DUPLICATE_ID" for e in val.errors)


def test_neighborhood_still_flags_invalid():
    val, _ = validate_neighborhoods(
        [{"neighborhood_id": "N1", "latitude": 120.5, "longitude": 78.0, "daily_orders": 10}])
    assert any(e.code == "OUT_OF_RANGE" for e in val.errors)


def test_vehicle_warehouse_csv_alias_and_json():
    v_val, vs = parse_vehicles_csv("vehicle,cap,cost\nvan,100,10.0\n")
    assert v_val.valid and vs[0]["vehicle_type"] == "van"
    w_val, ws = parse_warehouses_csv("id,lat,lng\nEX-W1,17.38,78.48\n")
    assert w_val.valid and ws[0]["warehouse_id"] == "EX-W1"
    jv_val, jv = parse_vehicles_json('[{"vehicle_type":"bike","capacity":20,"cost_per_km":4.0}]')
    assert jv_val.valid
    jw_val, jw = parse_warehouses_json('{"warehouses":[{"warehouse_id":"EX-W1","latitude":17.0,"longitude":78.0}]}')
    assert jw_val.valid


def test_seeders_deterministic_seed42():
    assert generate_synthetic_vehicles(seed=42, count=4) == generate_synthetic_vehicles(seed=42, count=4)
    assert generate_synthetic_warehouses(seed=42, count=2) == generate_synthetic_warehouses(seed=42, count=2)
    vs = generate_synthetic_vehicles(seed=42, count=4)
    assert [v["vehicle_type"] for v in vs] == ["bike", "van", "truck", "ev_van"]
    ws = generate_synthetic_warehouses(seed=42, count=2)
    assert [w["warehouse_id"] for w in ws] == ["EX-W1", "EX-W2"]
    v_val, _ = validate_vehicles(vs)
    w_val, _ = validate_warehouses(ws)
    assert v_val.valid and w_val.valid


def test_empty_datasets_flagged():
    for fn in (validate_vehicles, validate_warehouses, validate_neighborhoods):
        val, _ = fn([])
        assert not val.valid
        assert any(e.code == "EMPTY_DATASET" for e in val.errors)
