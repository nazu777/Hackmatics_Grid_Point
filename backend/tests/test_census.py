"""Tests for US Census demand provider (no network — all HTTP mocked)."""
import json
import pytest
from fastapi.testclient import TestClient

from src import census
from src.validation import validate_neighborhoods


@pytest.fixture(autouse=True)
def _clean_env_and_cache(monkeypatch, tmp_path):
    monkeypatch.delenv("CENSUS_KEY", raising=False)
    monkeypatch.setenv("CENSUS_CACHE_DIR", str(tmp_path / "census"))
    yield


ACS_ROWS = [
    ["NAME", "B01003_001E", "state", "county", "tract"],
    ["Census Tract 1, Clark County, Nevada", "4000", "32", "003", "000100"],
    ["Census Tract 2, Clark County, Nevada", "2500", "32", "003", "000200"],
]

GAZ_TXT = (
    "USPS\tGEOID\tALAND\tAWATER\tALAND_SQMI\tAWATER_SQMI\tINTPTLAT\tINTPTLONG   \n"
    "NV\t32003000100\t100\t0\t1.0\t0.\t36.100000\t-115.100000   \n"
    "NV\t32003000200\t100\t0\t1.0\t0.\t36.200000\t-115.200000   \n"
)


class FakeResp:
    def __init__(self, data: bytes):
        self._data = data

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def read(self):
        return self._data


def _mock_http(monkeypatch, acs_rows=ACS_ROWS, gaz_txt=GAZ_TXT):
    def fake_open(req, timeout=25):
        url = req.full_url if hasattr(req, "full_url") else str(req)
        if "api.census.gov" in url:
            return FakeResp(json.dumps(acs_rows).encode())
        return FakeResp(gaz_txt.encode())

    import urllib.request
    monkeypatch.setattr(urllib.request, "urlopen", fake_open)


def test_list_cities_no_network():
    cities = census.list_cities()
    ids = [c["city_id"] for c in cities]
    for want in ("new-york", "los-angeles", "las-vegas", "chicago", "houston", "san-francisco"):
        assert want in ids


def test_city_demand_join_and_math(monkeypatch):
    _mock_http(monkeypatch)
    d = census.get_city_demand("las-vegas", orders_per_1000=5.0)
    assert d["label"] == "Las Vegas, NV"
    assert d["tracts"] == 2 and len(d["neighborhoods"]) == 2
    by_id = {n["neighborhood_id"]: n for n in d["neighborhoods"]}
    assert by_id["T32003000100"]["daily_orders"] == 20  # 4000 * 5/1000
    assert by_id["T32003000200"]["daily_orders"] == 12  # round(12.5) banker's
    assert by_id["T32003000100"]["latitude"] == pytest.approx(36.1)
    assert by_id["T32003000100"]["zone"] == "Clark County"
    val, _ = validate_neighborhoods(d["neighborhoods"])
    assert val.valid is True


def test_unknown_city():
    with pytest.raises(ValueError):
        census.get_city_demand("atlantis")


def test_unreachable_data(monkeypatch):
    import urllib.request
    monkeypatch.setattr(urllib.request, "urlopen", lambda req, timeout=25: (_ for _ in ()).throw(OSError("down")))
    with pytest.raises(RuntimeError):
        census.get_city_demand("las-vegas")


def test_census_api(monkeypatch):
    _mock_http(monkeypatch)
    from src.api import app
    client = TestClient(app)
    r = client.get("/api/census/cities")
    assert r.status_code == 200
    assert len(r.json()["cities"]) == 6
    r2 = client.get("/api/census/demand", params={"city": "las-vegas", "orders_per_1000": 5})
    assert r2.status_code == 200
    body = r2.json()
    assert len(body["neighborhoods"]) == 2
    assert "5a70dd" not in r2.text  # key never leaks
    r3 = client.get("/api/census/demand", params={"city": "nope"})
    assert r3.status_code == 400
