"""
Phase 1 Acceptance Tests (phases.md Phase 1 Acceptance Criteria):
- Upload sample CSV/JSON (10-1,000 rows) -> no crash
- Invalid rows flagged
- Synthetic generator yields mappable data
- Performance target: parse & validate 1,000 nodes < 5s
"""
import time
import os
from pathlib import Path
from src.data_ingestion import parse_csv_content, parse_json_content, compute_dataset_summary
from src.schema import SyntheticGenerationConfig
from src.synthetic import generate_synthetic_dataset
from src.validation import validate_neighborhoods

SAMPLES_DIR = Path(__file__).resolve().parent.parent.parent / "data" / "samples"


def test_acceptance_hyderabad_sample():
    csv_path = SAMPLES_DIR / "hyderabad_demand.csv"
    with open(csv_path, "r") as f:
        content = f.read()
    val, nodes = parse_csv_content(content)
    assert val.valid is True
    assert len(nodes) == 20
    summary = compute_dataset_summary(nodes)
    assert summary["count"] == 20
    assert summary["total_orders"] > 0
    # Coordinates centered in Hyderabad
    assert 17.0 <= summary["center"]["lat"] <= 18.0
    assert 78.0 <= summary["center"]["lon"] <= 79.0


def test_acceptance_flag_invalid_rows():
    csv_path = SAMPLES_DIR / "sample_with_errors.csv"
    with open(csv_path, "r") as f:
        content = f.read()
    val, clean = parse_csv_content(content)
    assert val.valid is False
    assert len(val.errors) >= 5

    error_codes = {e.code for e in val.errors}
    # Verify all expected schema validation error types are flagged
    assert "OUT_OF_RANGE" in error_codes
    assert "DUPLICATE_ID" in error_codes
    assert "NULL_OR_EMPTY" in error_codes or "NULL_VALUE" in error_codes


def test_acceptance_json_sample():
    json_path = SAMPLES_DIR / "neighborhoods_sample.json"
    with open(json_path, "r") as f:
        content = f.read()
    val, nodes = parse_json_content(content)
    assert val.valid is True
    assert len(nodes) == 8


def test_acceptance_1000_nodes_performance():
    csv_path = SAMPLES_DIR / "large_1000_nodes.csv"
    with open(csv_path, "r") as f:
        content = f.read()

    start_time = time.time()
    val, nodes = parse_csv_content(content)
    elapsed = time.time() - start_time

    assert val.valid is True
    assert len(nodes) == 1000
    # Strict latency verification: target < 5s, typical < 0.2s
    assert elapsed < 5.0, f"Processing 1000 nodes took {elapsed:.2f}s, exceeding 5s target"
