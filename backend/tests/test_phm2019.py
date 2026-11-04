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
    assert "no released crack-length ground truth" in report["error"]
