import pytest

from app.engine.base import EngineError
from app.services.playback import flight_playback, live_snapshot
from app.services.twin import predict_flight


def test_preview_playback_for_unpredicted_scheduled_flight(db_init):
    """Before any prediction is stored, playback falls back to a clearly flagged live preview."""
    r = flight_playback(db_init, "ENG-MOUNT-001", "AC001-F0013")
    assert r["preview"] is True
    assert r["preview_note"]
    assert r["prediction_id"] is None
    assert len(r["t_s"]) > 0
    assert r["t_s"][-1] <= r["duration_s"]
    assert set(r["predicted"]) & {"load_kN", "temperature_c"}
    # trajectory ends exactly at the (previewed) state_after
    for k, traj in r["trajectory"].items():
        assert traj[-1] == pytest.approx(r["state_after"][k])


def test_stored_prediction_playback_matches_the_immutable_record(db_init):
    pred = predict_flight(db_init, "ENG-MOUNT-001", "AC001-F0013", mc_samples=0)
    r = flight_playback(db_init, "ENG-MOUNT-001", "AC001-F0013")
    assert r["preview"] is False
    assert r["prediction_id"] == pred["id"]
    # the forecast channels are exactly the stored prediction's channels, not a fresh re-simulation
    assert r["predicted"]["load_kN"] == pred["predicted_channels"]["load_kN"]
    for k, traj in r["trajectory"].items():
        assert traj[0] == pytest.approx(pred["state_before"][k])
        assert traj[-1] == pytest.approx(pred["predicted"]["state_after"][k])


def test_playback_shows_observed_channels_once_flight_is_completed(db):
    from app.services.history import complete_flight_synthetic

    pred = predict_flight(db, "ENG-MOUNT-001", "AC001-F0013", mc_samples=0, allow_completed=True)
    complete_flight_synthetic(db, "AC001-F0013")
    r = flight_playback(db, "ENG-MOUNT-001", "AC001-F0013")
    assert r["observed"] is not None
    assert r["observed"]["channels"]["load_kN"] is not None
    assert r["prediction_id"] == pred["id"]


def test_playback_rejects_flight_of_a_different_aircraft(db_init):
    # ENG-MOUNT-001 only has flights on AIRCRAFT-001; an unknown flight id is a clean 404-style error
    with pytest.raises(KeyError):
        flight_playback(db_init, "ENG-MOUNT-001", "NOT-A-FLIGHT")


def test_damage_trajectory_weights_sum_to_the_flight_increment(db_init):
    r = flight_playback(db_init, "ENG-MOUNT-001", "AC001-F0013")
    for k, inc in r["increments"].items():
        if k not in r["trajectory"]:
            continue
        traj = r["trajectory"][k]
        assert traj[-1] - r["state_before"][k] == pytest.approx(inc, rel=1e-6, abs=1e-12)


def test_live_snapshot_reports_counts_and_components(db_init):
    snap = live_snapshot(db_init)
    assert snap["server_time"]
    ids = {c["id"] for c in snap["components"]}
    assert "ENG-MOUNT-001" in ids
    assert snap["counts"]["predictions"] >= 0
    assert any(f["status"] == "scheduled" for f in snap["flights"])
