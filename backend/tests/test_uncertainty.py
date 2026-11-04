"""Uncertainty tests: reproducibility, interval correctness, input validation, calibration labelling."""
import numpy as np
import pytest

from app.engine.base import EngineError
from app.services.uncertainty import monte_carlo

NORMAL = {"profile": "normal"}


def _cracked(db):
    comp = db.get("components", "ENG-MOUNT-001")
    comp["state"]["crack_length_m"] = 0.006
    return comp


def test_reproducible_with_fixed_seed(db):
    comp = _cracked(db)
    u1 = monte_carlo(comp, [NORMAL, NORMAL], n_samples=60, seed=123)
    u2 = monte_carlo(comp, [NORMAL, NORMAL], n_samples=60, seed=123)
    assert u1["key_percentiles"] == u2["key_percentiles"]
    assert monte_carlo(comp, [NORMAL, NORMAL], n_samples=60, seed=124)["key_percentiles"] != u1["key_percentiles"]


def test_percentiles_ordered_and_bracket_nominal(db):
    comp = _cracked(db)
    u = monte_carlo(comp, [NORMAL] * 3, n_samples=200, seed=1)
    p5, p50, p95 = u["key_percentiles"]["p5"], u["key_percentiles"]["p50"], u["key_percentiles"]["p95"]
    for i in range(3):
        assert p5[i] <= p50[i] <= p95[i]
    assert p5[-1] < comp["state"]["crack_length_m"] * 1.01 < p95[-1]
    assert len(p50) == u["n_flights"] == 3


def test_percentile_computation_matches_numpy():
    arr = np.arange(1, 101, dtype=float).reshape(100, 1)
    assert np.percentile(arr, 5, axis=0)[0] == pytest.approx(5.95)


def test_invalid_inputs_rejected(db):
    comp = db.get("components", "ENG-MOUNT-001")
    with pytest.raises(EngineError):
        monte_carlo(comp, [NORMAL], n_samples=5, seed=1)
    with pytest.raises(EngineError):
        monte_carlo(comp, [NORMAL], n_samples=100, seed=-1)


def test_not_presented_as_calibrated(db):
    comp = db.get("components", "HYD-ACT-001")
    u = monte_carlo(comp, [NORMAL], n_samples=50, seed=2)
    assert "NOT CALIBRATED" in u["calibration_status"]
    assert 0.0 <= u["threshold_crossing_fraction"] <= 1.0


def test_uncertainty_classes_separated(db):
    comp = _cracked(db)
    u = monte_carlo(comp, [NORMAL], n_samples=20, seed=3)
    cls = u["uncertainty_classes"]
    assert "paris_C" in cls["parameter"]
    assert "crack_length_m" in cls["measurement"]
    assert "load_transfer_factor" in cls["operational"]
    assert "geometry_factor_Y" in cls["model_form"]


def test_sensitivity_identifies_initial_crack_dominant_short_horizon(db):
    comp = _cracked(db)
    u = monte_carlo(comp, [NORMAL], n_samples=200, seed=4)
    assert u["sensitivity_spearman"]["crack_length_m"] > 0.9
