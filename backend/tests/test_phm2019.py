from pathlib import Path

import pandas as pd

from app.services.phm2019 import build_report


def test_phm_benchmark_waits_for_local_data(tmp_path: Path):
    report = build_report(tmp_path)
    assert report["status"] == "not_ready"
    assert "T7 and T8" in " ".join(report["instructions"])


def test_phm_benchmark_uses_temporal_holdout_and_signal_features(tmp_path: Path):
    rows = [
        ["T1", 10000, 0.0], ["T1", 20000, 0.2], ["T1", 30000, 0.5],
        ["T2", 10000, 0.0], ["T2", 20000, 0.1], ["T2", 30000, 0.3],
    ]
    pd.DataFrame(rows, columns=["specimen", "cycle", "crack_length_mm"]).to_csv(tmp_path / "labels.csv", index=False)
    for cycle, amp in ((10000, 0.1), (20000, 0.2), (30000, 0.4)):
        folder = tmp_path / "raw" / "training" / "T1" / str(cycle)
        folder.mkdir(parents=True)
        pd.DataFrame({"time": [0.0, 0.1, 0.2], "ch1": [amp, amp * 2, amp], "ch2": [amp, amp * 3, -amp]}).to_csv(folder / "signal_1.csv", index=False)

    report = build_report(tmp_path)
    assert report["status"] == "ready"
    assert report["labels_loaded"] == 6
    assert report["rolling_origin"]["summary"]["scored_points"] == 2
    assert report["signal_features"]["files_found"] == 3
    assert report["signal_features"]["labelled_cycles_with_signals"] == 3
    assert "T1" in report["specimens"] and "T2" in report["specimens"]


def test_phm_validation_specimens_cannot_be_used_as_labelled_ground_truth(tmp_path: Path):
    pd.DataFrame(
        [["T7", 40000, 0.1]],
        columns=["specimen", "cycle", "crack_length_mm"],
    ).to_csv(tmp_path / "labels.csv", index=False)
    report = build_report(tmp_path)
    assert report["status"] == "invalid"
    assert "without released crack-length ground truth" in report["error"]


def test_phm_paris_integrator_is_scored_with_leave_one_specimen_out(tmp_path: Path):
    rows = []
    trajectories = {
        "T1": [0.50, 0.54, 0.60, 0.69],
        "T2": [0.48, 0.52, 0.58, 0.67],
        "T3": [0.52, 0.56, 0.62, 0.71],
    }
    cycles = [10000, 20000, 30000, 40000]
    for specimen, cracks in trajectories.items():
        for cycle, crack in zip(cycles, cracks):
            rows.append([specimen, cycle, crack])
        folder = tmp_path / "raw" / "training" / specimen
        folder.mkdir(parents=True)
        profile = pd.DataFrame({
            "time_s": [0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0],
            "stress_mpa": [0, 100, 0, 100, 0, 100, 0, 100, 0, 100, 0],
        })
        profile.to_csv(folder / "Constant Loading Profile-5 cycles.csv", index=False)

    pd.DataFrame(rows, columns=["specimen", "cycle", "crack_length_mm"]).to_csv(tmp_path / "labels.csv", index=False)
    report = build_report(tmp_path)

    assert report["status"] == "ready"
    paris = report["physics_paris_loo"]
    assert paris["status"] == "ready"
    assert paris["summary"]["scored_points"] >= 6
    assert paris["summary"]["mae_mm"] is not None
    assert paris["summary"]["rmse_mm"] is not None
    assert all(fold["specimen"] not in fold.get("fitted_parameters", {}).get("training_specimens", []) for fold in paris["by_specimen"] if fold["status"] == "scored")
    assert "does not validate the titanium-class engine-mount" in paris["transfer_limit"].lower()


def test_phm_labels_allow_zero_cycle_baseline(tmp_path: Path):
    pd.DataFrame(
        [["T1", 0, 0.0], ["T1", 10000, 0.5], ["T1", 20000, 0.6]],
        columns=["specimen", "cycle", "crack_length_mm"],
    ).to_csv(tmp_path / "labels.csv", index=False)
    report = build_report(tmp_path)
    assert report["status"] == "ready"
    assert report["labels_loaded"] == 3
