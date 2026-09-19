"""Tests for distance matrix calculations (schema.md §5)."""
import numpy as np
import pytest
from src.distance import (
    haversine_distance_matrix,
    euclidean_distance_matrix,
    manhattan_distance_matrix,
    compute_distance_matrix
)


def test_haversine_known_distance():
    # Hyderabad Charminar (17.361564, 78.474665) to Hitec City (17.4435, 78.3772)
    p1 = np.array([[17.361564, 78.474665]])
    p2 = np.array([[17.443500, 78.377200]])

    dist = haversine_distance_matrix(p1, p2)
    assert dist.shape == (1, 1)
    # Great circle distance is ~13.7 km
    assert 13.0 <= dist[0, 0] <= 14.5


def test_distance_matrix_dimensions():
    # 5 demand points, 3 warehouse points
    c1 = np.array([
        [17.38, 78.48],
        [17.40, 78.49],
        [17.42, 78.45],
        [17.36, 78.44],
        [17.45, 78.38]
    ])
    c2 = np.array([
        [17.39, 78.47],
        [17.41, 78.46],
        [17.44, 78.39]
    ])

    for metric in ["haversine", "euclidean", "manhattan"]:
        mat = compute_distance_matrix(c1, c2, metric=metric)
        assert mat.shape == (5, 3)
        assert np.all(mat >= 0.0)


def test_zero_distance_self():
    coords = np.array([[17.385, 78.486], [12.971, 77.594]])
    for metric in ["haversine", "euclidean", "manhattan"]:
        mat = compute_distance_matrix(coords, coords, metric=metric)
        assert mat.shape == (2, 2)
        assert pytest.approx(mat[0, 0], abs=1e-5) == 0.0
        assert pytest.approx(mat[1, 1], abs=1e-5) == 0.0


def test_metric_ordering():
    # Manhattan distance >= Euclidean distance between non-collinear points
    p1 = np.array([[17.0, 78.0]])
    p2 = np.array([[17.1, 78.1]])
    euc = euclidean_distance_matrix(p1, p2)[0, 0]
    man = manhattan_distance_matrix(p1, p2)[0, 0]
    assert man >= euc
