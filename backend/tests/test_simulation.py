"""Simulation tests: sequential state updates, determinism, distinguishability, thresholds."""
import pytest

from app.engine.base import EngineError
from app.services.simulation import run_simulation, simulate_sequence

NORMAL = {"profile": "normal"}
HIGH = {"profile": "increased_load"}


def test_flight_updates_component_state(db_init):
    db = db_init
    run = run_simulation(db, "ENG-MOUNT-001", [NORMAL], mc_samples=0)
    comp = db.get("components", "ENG-MOUNT-001")
    assert run["n_flights"] == 1
    assert run["flights"][0]["state_after"]["crack_length_m"] > comp["state"]["crack_length_m"]
    assert run["flights"][0]["state_after"]["miner_damage"] > comp["state"]["miner_damage"]
    # a what-if simulation is a prediction only: the component record itself is unchanged
    assert comp["state"]["flights"] == 1712


def test_multiple_flights_accumulate_sequentially(db_init):
    db = db_init
    run = run_simulation(db, "ENG-MOUNT-001", [NORMAL, NORMAL, NORMAL], mc_samples=0)
    a = [f["state_after"]["crack_length_m"] for f in run["flights"]]
    d = [f["state_after"]["miner_damage"] for f in run["flights"]]
    assert a[0] < a[1] < a[2]
    assert d[0] < d[1] < d[2]
    assert run["flights"][2]["state_after"]["flights"] == 1715


def test_deterministic_repeatability(db):
    r1 = run_simulation(db, "ENG-MOUNT-001", [NORMAL, HIGH], mc_samples=100, seed=7)
    r2 = run_simulation(db, "ENG-MOUNT-001", [NORMAL, HIGH], mc_samples=100, seed=7)
    assert r1["final_state"] == r2["final_state"]
    assert r1["uncertainty"]["key_percentiles"] == r2["uncertainty"]["key_percentiles"]


def test_different_profiles_distinguishable(db_init):
    db = db_init
    r_norm = run_simulation(db, "ENG-MOUNT-001", [NORMAL] * 3, mc_samples=0)
    r_high = run_simulation(db, "ENG-MOUNT-001", [HIGH] * 3, mc_samples=0)
    assert r_high["final_state"]["miner_damage"] > r_norm["final_state"]["miner_damage"]
    assert r_high["final_state"]["crack_length_m"] > r_norm["final_state"]["crack_length_m"]


def test_repeat_expands_flights(db):
    run = run_simulation(db, "HYD-ACT-001", [{"profile": "normal", "repeat": 4}], mc_samples=0)
    assert run["n_flights"] == 4
    assert len(run["missions"]) == 1
    assert run["missions"][0]["flights"] == [1, 2, 3, 4]


def test_threshold_crossing_stops_sequence(db):
    comp = db.get("components", "ENG-MOUNT-001")
    comp["state"]["crack_length_m"] = 0.0105  # near a_c for a heavily loaded mission
    db.upsert("components", comp)
    run = run_simulation(db, "ENG-MOUNT-001", [{"profile": "increased_load", "load_factor": 2.0, "repeat": 5}], mc_samples=0)
    assert run["threshold_status"] == "threshold_crossed"
    assert run["stop_reason"]
    assert run["n_flights"] < 5
    assert run["flights"][-1]["threshold_status"] == "threshold_crossed"


def test_no_forced_failure_when_within_threshold(db):
    run = run_simulation(db, "LAND-GEAR-001", [NORMAL] * 5, mc_samples=0)
    assert run["threshold_status"] == "within_threshold"
    assert run["stop_reason"] is None


def test_invalid_mission_rejected(db):
    with pytest.raises(EngineError):
        run_simulation(db, "ENG-MOUNT-001", [{"profile": "normal", "load_factor": 10.0}], mc_samples=0)
    with pytest.raises(EngineError):
        run_simulation(db, "ENG-MOUNT-001", [], mc_samples=0)
    with pytest.raises(EngineError):
        run_simulation(db, "ENG-MOUNT-001", [NORMAL] * 11, mc_samples=0)


def test_catalogue_only_component_cannot_be_simulated(db):
    with pytest.raises(EngineError):
        run_simulation(db, "FAN-BLADE-001", [NORMAL], mc_samples=0)


def test_what_if_run_never_changes_the_twin(db):
    before = db.get("components", "ENG-MOUNT-001")
    run = run_simulation(db, "ENG-MOUNT-001", [NORMAL, NORMAL], mc_samples=0)
    after = db.get("components", "ENG-MOUNT-001")
    assert run["provenance"] == "what_if"
    assert after["state"] == before["state"] and after["model_version"] == before["model_version"]


def test_simulate_sequence_pure_function_does_not_persist(db):
    comp = db.get("components", "TURB-BLADE-001")
    body = simulate_sequence(comp, [NORMAL, {"profile": "high_temperature"}])
    assert body["n_flights"] == 2
    assert db.count("simulation_runs") == 0
    assert body["final_state"]["creep_strain"] > comp["state"]["creep_strain"]


@pytest.mark.parametrize("cid", ["ENG-MOUNT-001", "LAND-GEAR-001", "TURB-BLADE-001", "HYD-ACT-001"])
def test_all_modelled_components_run_all_presets(db, cid):
    run = run_simulation(db, cid, [{"profile": p} for p in ("normal", "increased_load", "high_temperature", "high_manoeuvre", "adverse_environment")], mc_samples=0)
    assert run["n_flights"] == 5
    assert run["remaining_life"]["unit"] == "flights of the reference mission"
