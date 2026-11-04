"""Reconciliation, calibration, evidence gate and inspection-update tests (prediction ↔ flight ID)."""
import numpy as np
import pytest

from app.engine.base import EngineError
from app.services.calibration import batch_least_squares, rls_estimate
from app.services.ground_truth import true_measurement
from app.services.history import complete_flight_synthetic
from app.services.inspection import add_inspection
from app.services.reconciliation import apply_operational_update, manual_observation, reconcile_prediction
from app.services.twin import commit_prediction, next_scheduled_flight, predict_flight

CID = "ENG-MOUNT-001"


def _loop(db, anomaly="none", mc=0):
    """Predict the next scheduled flight, fly it (synthetic), reconcile."""
    flight = next_scheduled_flight(db, CID)
    pred = predict_flight(db, CID, flight["id"], mc_samples=mc)
    complete_flight_synthetic(db, flight["id"], anomaly=anomaly)
    rec = reconcile_prediction(db, pred["id"])
    return flight, pred, rec


def test_rls_converges_to_batch_solution():
    rng = np.random.default_rng(0)
    x = rng.uniform(10, 50, 400)
    y = 1.12 * x + rng.normal(0, 1.0, 400)
    est = rls_estimate(x, y, theta0=1.0, P0=1.0, lam=1.0)
    assert est["theta"] == pytest.approx(batch_least_squares(x, y), rel=1e-3)
    assert abs(est["theta"] - 1.12) < 0.01


def test_prediction_linked_to_observation_by_flight_id(db_init):
    flight, pred, rec = _loop(db_init)
    assert rec["flight_id"] == flight["id"] == pred["flight_id"]
    obs = db_init.get("flight_records", rec["flight_record_id"])
    assert obs["flight_id"] == flight["id"] and obs["component_id"] == CID


def test_residuals_calculated_correctly(db_init):
    _, _, rec = _loop(db_init)
    ch = rec["channels"]["load_kN"]
    p = np.array(ch["predicted"]); a = np.array([np.nan if v is None else v for v in ch["actual"]]); r = np.array([np.nan if v is None else v for v in ch["residual"]])
    m = ~np.isnan(a)
    assert np.allclose(r[m], a[m] - p[m])
    assert ch["mae"] == pytest.approx(float(np.mean(np.abs(r[m]))))
    assert ch["mean_bias"] == pytest.approx(float(np.mean(r[m])))
    assert ch["relative_error"] == pytest.approx(ch["mae"] / float(np.mean(np.abs(p[m]))))


def test_forecast_and_as_flown_errors_are_separated(db_init):
    _, _, rec = _loop(db_init)
    assert "forecast_mean_relative_error" in rec["summary"]
    # the as-flown comparison removes schedule deviation, so it cannot be worse than the forecast on average
    assert rec["summary"]["mean_relative_error"] <= rec["summary"]["forecast_mean_relative_error"] + 0.02
    assert rec["explanation"]


def test_hidden_load_factor_recovered_from_history(db_init):
    comp = db_init.get("components", CID)
    assert abs(comp["response_params"]["load_transfer_factor"] - 1.12) < 0.03


def test_stage_a_only_touches_response_params(db_init):
    before = db_init.get("components", CID)
    _, _, rec = _loop(db_init)
    res = apply_operational_update(db_init, rec["id"])
    comp = res["component"]
    assert comp["state"] == before["state"]
    assert {k: v["value"] for k, v in comp["parameters"].items()} == {k: v["value"] for k, v in before["parameters"].items()}
    assert set(res["update"]["changes"]) <= {"load_transfer_factor", "thermal_response_factor", "vibration_response_factor", "pressure_response_factor"}
    assert comp["model_version"] == before["model_version"] + 1


def test_update_cannot_be_applied_twice(db_init):
    _, _, rec = _loop(db_init)
    apply_operational_update(db_init, rec["id"])
    with pytest.raises(EngineError):
        apply_operational_update(db_init, rec["id"])


@pytest.mark.parametrize("anomaly,expected", [("dropout", "reject"), ("outliers", "reject"), ("sensor_bias", "request_more_evidence"), ("wrong_component", "reject")])
def test_unreliable_observations_rejected(db_init, anomaly, expected):
    before = db_init.get("components", CID)
    _, _, rec = _loop(db_init, anomaly)
    assert rec["gate"]["decision"] == expected
    res = apply_operational_update(db_init, rec["id"])
    assert res["update"]["applied"] is False
    assert res["component"]["model_version"] == before["model_version"]
    assert res["component"]["response_params"] == before["response_params"]
    if expected == "request_more_evidence":
        assert res["component"].get("uncertainty_inflation", 1.0) > 1.0


def test_commit_advances_state_as_flown_and_once(db_init):
    before = db_init.get("components", CID)
    flight, pred, rec = _loop(db_init)
    apply_operational_update(db_init, rec["id"])
    comp = commit_prediction(db_init, pred["id"])
    assert comp["state"]["flights"] == before["state"]["flights"] + 1
    assert comp["state"]["crack_length_m"] > before["state"]["crack_length_m"]
    assert comp["flight_log"][-1]["flight_id"] == flight["id"]
    with pytest.raises(EngineError):
        commit_prediction(db_init, pred["id"])


def test_commit_requires_completed_flight(db_init):
    flight = next_scheduled_flight(db_init, CID)
    pred = predict_flight(db_init, CID, flight["id"], mc_samples=0)
    with pytest.raises(EngineError):
        commit_prediction(db_init, pred["id"])


def test_inspection_updates_damage_state(db_init):
    before = db_init.get("components", CID)["state"]["crack_length_m"]
    insp = add_inspection(db_init, {"component_id": CID, "inspection_date": "2026-11-04", "method": "ultrasonic", "quantity": "crack_length_m", "measured_value": round(before * 1e3 + 0.3, 3), "unit": "mm", "measurement_uncertainty": 0.1, "confidence": "high"})
    comp = db_init.get("components", CID)
    assert insp["update"]["applied"] is True
    assert before < comp["state"]["crack_length_m"] < before + 0.3e-3


def test_new_defect_initialises_state_at_measurement(db):
    comp = db.get("components", "ENG-MOUNT-002")
    assert comp["state"]["crack_length_m"] == 0.0
    insp = add_inspection(db, {"component_id": "ENG-MOUNT-002", "inspection_date": "2026-11-04", "method": "ultrasonic", "quantity": "crack_length_m", "measured_value": 3.2, "unit": "mm", "measurement_uncertainty": 0.2, "confidence": "high"})
    assert insp["update"]["decision"] == "accept"
    assert db.get("components", "ENG-MOUNT-002")["state"]["crack_length_m"] == pytest.approx(0.0032)


def test_contradictory_inspection_rejected(db_init):
    insp = add_inspection(db_init, {"component_id": CID, "inspection_date": "2026-11-04", "method": "ultrasonic", "quantity": "crack_length_m", "measured_value": 3.0, "unit": "mm", "measurement_uncertainty": 0.1})
    assert insp["update"]["decision"] == "reject"


def test_qualitative_method_requests_more_evidence(db_init):
    insp = add_inspection(db_init, {"component_id": CID, "inspection_date": "2026-11-04", "method": "visual", "quantity": "crack_length_m", "measured_value": 6.5, "unit": "mm", "measurement_uncertainty": 0.5})
    assert insp["update"]["decision"] == "request_more_evidence"
    assert insp["update"]["applied"] is False


def test_missing_uncertainty_reduces_confidence(db_init):
    insp = add_inspection(db_init, {"component_id": CID, "inspection_date": "2026-11-04", "method": "ultrasonic", "quantity": "crack_length_m", "measured_value": 6.3, "unit": "mm"})
    assert insp["update"]["decision"] == "accept_reduced_confidence"


def test_coefficient_identification_after_long_interval(db_init):
    # fly many flights so that growth becomes identifiable against the measurement uncertainty
    from app.services.history import ROUTE_CYCLE
    from app.db import now_iso

    comp = db_init.get("components", CID)
    for i in range(80):
        seq = 100 + i
        f = db_init.upsert("flights", {"id": f"AC001-F{seq:04d}", "aircraft_id": comp["aircraft_id"], "sequence": seq, "flight_date": f"2027-{(i // 28) + 1:02d}-{(i % 28) + 1:02d}", "event_time": f"2027-{(i // 28) + 1:02d}-{(i % 28) + 1:02d}T10:00:00+00:00", "route_or_mission": ROUTE_CYCLE[i % 3], "scheduled": {"route": ROUTE_CYCLE[i % 3], "duration_min": 120, "landing_cycles": 1, "payload_fraction": 0.8, "expected_temperature_c": 20.0, "expected_environment": "benign"}, "actual": None, "status": "scheduled", "provenance": "synthetic_demo"})
        pred = predict_flight(db_init, CID, f["id"], mc_samples=0)
        complete_flight_synthetic(db_init, f["id"])
        rec = reconcile_prediction(db_init, pred["id"])
        apply_operational_update(db_init, rec["id"])
        commit_prediction(db_init, pred["id"])
    meas = true_measurement(db_init, CID, "crack_length_m", 0.0001, seed=3)
    c_before = db_init.get("components", CID)["parameters"]["paris_C"]["value"]
    insp = add_inspection(db_init, {"component_id": CID, "inspection_date": "2027-03-01", "method": "ultrasonic", "quantity": "crack_length_m", "measured_value": round(meas * 1e3, 3), "unit": "mm", "measurement_uncertainty": 0.1})
    c_after = db_init.get("components", CID)["parameters"]["paris_C"]["value"]
    assert insp["update"]["applied"]
    assert any("re-estimated" in r for r in insp["update"]["reasons"])
    assert c_after != c_before and 0.5 * c_before <= c_after <= 2 * c_before  # bounded single-update change


def test_model_update_history_preserved(db_init):
    n0 = len(db_init.list("model_updates", {"component_id": CID}))
    _, pred, rec = _loop(db_init)
    apply_operational_update(db_init, rec["id"])
    add_inspection(db_init, {"component_id": CID, "inspection_date": "2026-11-06", "method": "ultrasonic", "quantity": "crack_length_m", "measured_value": 6.3, "unit": "mm", "measurement_uncertainty": 0.1})
    ups = db_init.list("model_updates", {"component_id": CID})
    assert len(ups) == n0 + 2
    assert ups[-2]["stage"] == "A_operational" and ups[-2]["flight_id"] == pred["flight_id"]
    assert ups[-1]["stage"] == "B_damage_state"
    assert ups[-1]["version_before"] == ups[-2]["version_after"]


def test_manual_observation_reconciles(db_init):
    flight = next_scheduled_flight(db_init, CID)
    pred = predict_flight(db_init, CID, flight["id"], mc_samples=0)
    complete_flight_synthetic(db_init, flight["id"])
    obs = manual_observation(db_init, CID, flight["id"], {"load_kN": 80.0, "temperature_c": 40.0})
    rec = reconcile_prediction(db_init, pred["id"], obs["id"])
    assert rec["observation_provenance"] == "manual"
    assert set(rec["channels"]) == {"load_kN", "temperature_c"}
    with pytest.raises(EngineError):
        manual_observation(db_init, CID, flight["id"], {"pressure_bar": 100.0})


def test_synthetic_observation_is_labelled(db_init):
    _, _, rec = _loop(db_init)
    assert "SYNTHETIC" in rec["observation_label"]
    assert rec["observation_provenance"] == "synthetic_ground_truth"
