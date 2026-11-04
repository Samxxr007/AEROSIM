"""Digital-twin lifecycle: history ingestion, condition resolution, leakage prevention, immutability, replay, maintenance, A/B/C experiment."""
import pytest

from app.engine.base import EngineError
from app.services.history import complete_flight_synthetic
from app.services.twin import apply_maintenance, next_scheduled_flight, predict_flight, replay_history, resolve_conditions, twin_status
from app.services.validation import chronological_experiment

CID = "ENG-MOUNT-001"


def test_each_instance_has_its_own_history(db):
    a = db.list("flight_records", {"component_id": "ENG-MOUNT-001"})
    b = db.list("flight_records", {"component_id": "ENG-MOUNT-002"})
    assert len(a) == len(b) == 12
    assert a[0]["channels"]["load_kN"] != b[0]["channels"]["load_kN"]
    ia = db.list("inspections", {"component_id": "ENG-MOUNT-001"})
    ib = db.list("inspections", {"component_id": "ENG-MOUNT-002"})
    assert any(i["measured_value"] for i in ia) and not any(i["measured_value"] for i in ib)


def test_replay_initialises_twin_from_own_history(db):
    out = replay_history(db, CID)
    comp = out["component"]
    assert comp["history_initialised"] is True
    assert comp["model_version"] > 1
    assert comp["state"]["crack_length_m"] > 0  # crack learned from the UT finding, not from sensor data
    assert comp["state"]["flights"] == 1712
    assert abs(comp["response_params"]["load_transfer_factor"] - 1.12) < 0.03
    assert len(out["metrics"]) == 12
    # other instances remain untouched
    assert db.get("components", "ENG-MOUNT-002")["history_initialised"] is False


def test_replay_is_deterministic(db):
    s1 = replay_history(db, CID)["component"]["state"]
    s2 = replay_history(db, CID)["component"]["state"]
    assert s1 == s2


def test_stage_b_disabled_never_learns_crack(db):
    out = replay_history(db, CID, stage_a=True, stage_b=False)
    assert out["component"]["state"]["crack_length_m"] == 0.0
    assert all(m["state_error"] < 0 for m in out["metrics"])  # twin underestimates the hidden crack


def test_condition_resolution_priorities(db):
    comp = db.get("components", CID)
    flight = next_scheduled_flight(db, CID)
    res = resolve_conditions(db, comp, flight)
    assert res["provenance"]["duration_min"] == "scheduled"
    assert res["provenance"]["load_factor"].startswith("derived from planned payload")
    assert res["provenance"]["manoeuvre_intensity"].startswith("historical comparable flights")
    assert "manoeuvre_intensity" in res["estimated_fields"] and "duration_min" not in res["estimated_fields"]
    assert res["uncertainty"]["manoeuvre_intensity"] is not None
    # engineering default when no comparable flights exist
    for f in db.list("flights"):
        if f["status"] == "completed":
            db.delete("flights", f["id"])
    res2 = resolve_conditions(db, comp, flight)
    assert res2["provenance"]["manoeuvre_intensity"].startswith("engineering estimate")


def test_no_leakage_from_future_flights(db):
    comp = db.get("components", CID)
    flights = sorted([f for f in db.list("flights") if f["status"] == "completed"], key=lambda f: f["sequence"])
    first = flights[0]
    res = resolve_conditions(db, comp, first)
    assert res["comparables_used"] == []  # nothing earlier than flight 1
    fifth = flights[4]
    res5 = resolve_conditions(db, comp, fifth)
    assert all(db.get("flights", fid)["event_time"] < fifth["event_time"] for fid in res5["comparables_used"])


def test_prediction_is_immutable_and_pre_flight_only(db_init):
    flight = next_scheduled_flight(db_init, CID)
    pred = predict_flight(db_init, CID, flight["id"], mc_samples=20)
    assert pred["immutable"] and pred["status"] == "pending"
    assert pred["model_version"] == db_init.get("components", CID)["model_version"]
    assert pred["input_data_version"].startswith("obs12-insp2-mnt1")
    with pytest.raises(EngineError):
        predict_flight(db_init, CID, flight["id"], mc_samples=0)  # duplicate
    complete_flight_synthetic(db_init, flight["id"])
    nxt = next_scheduled_flight(db_init, CID)
    assert nxt["id"] != flight["id"]
    with pytest.raises(EngineError):
        predict_flight(db_init, "ENG-MOUNT-002", flight["id"], mc_samples=0)  # completed → no post-hoc "prediction"
    # the stored prediction did not change after the flight
    assert db_init.get("predictions", pred["id"])["predicted"] == pred["predicted"]


def test_prediction_rejects_foreign_aircraft_flight(db_init):
    db_init.upsert("aircraft", {"id": "AIRCRAFT-002", "aircraft_type": "x", "registration_or_demo_id": "DEMO-002", "configuration": {}, "provenance": "manual"})
    f = db_init.insert("flights", {"id": "AC002-F0001", "aircraft_id": "AIRCRAFT-002", "sequence": 1, "flight_date": "2026-12-01", "event_time": "2026-12-01T10:00:00+00:00", "route_or_mission": "X", "scheduled": {"duration_min": 60, "landing_cycles": 1}, "actual": None, "status": "scheduled", "provenance": "manual"})
    with pytest.raises(EngineError):
        predict_flight(db_init, CID, f["id"], mc_samples=0)


def test_maintenance_repair_resets_state_in_replay(db):
    out = replay_history(db, "HYD-ACT-001")
    comp = out["component"]
    assert comp["state"]["wear_indicator"] < 0.1  # seals replaced on 2026-09-20 (W → 0.02) then a few flights
    ups = db.list("model_updates", {"component_id": "HYD-ACT-001"})
    assert any(u["evidence"].get("type") == "maintenance" and u["applied"] for u in ups)


def test_maintenance_replacement_resets_to_new_state(db_init):
    rec = db_init.insert("maintenance", {"component_id": CID, "aircraft_id": "AIRCRAFT-001", "maintenance_date": "2026-11-10", "event_time": "2026-11-10T15:00:00+00:00", "activity": "Lug replaced", "repair_or_replacement": "replacement", "damage_before": None, "damage_after": {"crack_length_m": 0.0}, "maintenance_reference": "WO-1", "provenance": "manual", "applied_in_history": False})
    res = apply_maintenance(db_init, rec["id"])
    assert res["component"]["state"]["crack_length_m"] == 0.0
    assert res["component"]["state"]["miner_damage"] == 0.0
    assert res["component"]["response_params"]["load_transfer_factor"] == 1.0


def test_twin_status_dashboard_fields(db_init):
    st = twin_status(db_init, CID)
    assert st["history_initialised"] and st["data_availability"]["observations"] == 12
    assert st["next_scheduled_flight"]["id"] == "AC001-F0013"
    assert st["latest_inspection"]["method"] == "ultrasonic"
    assert "ready" in st["next_prediction_status"]


def test_chronological_experiment_measures_three_variants(db):
    exp = chronological_experiment(db, CID)
    s = exp["summary"]
    assert set(s) == {"A", "B", "C", "C_sparse"}
    assert exp["n_flights"] == 12
    assert s["A"]["final_model_version"] == 1
    assert s["B"]["mean_forecast_rel_error"] < s["A"]["mean_forecast_rel_error"]
    assert s["C"]["mean_abs_state_error"] < s["A"]["mean_abs_state_error"]
    assert exp["conclusions"]["operational_calibration_reduced_forecast_error"] is True
    assert exp["conclusions"]["two_stage_reduced_state_error"] is True
    # the main database was not modified by the experiment
    assert db.get("components", CID)["history_initialised"] is False
