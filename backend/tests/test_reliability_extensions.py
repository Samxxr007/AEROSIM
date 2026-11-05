from app.services.data_trust import evaluate_record, evaluate_batch
from app.services.conformal import conformal_quantile, calibrate_rul
from app.services.federated import aggregate_updates


def test_data_trust_accepts_complete_documented_record():
    result = evaluate_record({
        "source": "maintenance_export.csv", "source_id": "src-1", "provenance": "uploaded",
        "event_time": "2026-11-01T10:00:00+00:00", "required_fields": ["temperature"],
        "payload": {"temperature": 420}, "numeric_values": {"temperature": 420},
        "engineering_bounds": {"temperature": {"min": 0, "max": 900}},
    })
    assert result["decision"] == "accept"
    assert result["eligible_for_operational_calibration"] is True
    assert result["eligible_for_damage_update"] is False


def test_data_trust_quarantines_conflict_and_rejects_implausibility():
    quarantined = evaluate_record({"source": "a", "source_id": "1", "provenance": "uploaded", "cross_source_conflict": True})
    rejected = evaluate_record({"source": "a", "source_id": "2", "provenance": "uploaded", "numeric_values": {"stress": 999}, "engineering_bounds": {"stress": {"max": 500}}})
    assert quarantined["decision"] == "quarantine"
    assert rejected["decision"] == "reject"


def test_batch_counts_all_decisions():
    result = evaluate_batch([{"source": "a", "source_id": "1", "provenance": "uploaded"}])
    assert result["total"] == 1
    assert result["counts"]["accept"] == 1


def test_conformal_finite_sample_quantile_and_interval():
    assert conformal_quantile([1, 2, 3, 4, 5], 0.2) == 5
    result = calibrate_rul(
        [{"event_time": f"2026-10-{i+1:02d}", "flight_id": f"F{i}", "predicted_rul": 100-i, "actual_rul": 102-i} for i in range(25)],
        point_estimate=70, alpha=0.1, min_calibration=20,
    )
    assert result["calibrated"] is True
    assert result["interval"]["lower"] <= 70 <= result["interval"]["upper"]
    assert result["calibration_count"] == 25


def test_conformal_refuses_insufficient_history():
    result = calibrate_rul([], 100, min_calibration=20)
    assert result["calibrated"] is False
    assert result["interval"] is None


def test_federated_weighted_aggregation_does_not_transfer_raw_records():
    result = aggregate_updates([
        {"client_id": "A", "sample_count": 10, "parameters": {"load_factor": 1.0, "thermal": 2.0}},
        {"client_id": "B", "sample_count": 30, "parameters": {"load_factor": 2.0, "thermal": 4.0}},
    ])
    assert result["status"] == "aggregated"
    assert result["shared_parameters"]["load_factor"] == 1.75
    assert result["raw_records_shared"] is False


def test_federated_requires_multiple_eligible_clients():
    result = aggregate_updates([{"client_id": "A", "sample_count": 10, "parameters": {"p": 1.0}}])
    assert result["status"] == "not_aggregated"
