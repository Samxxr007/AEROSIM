"""Cross-cutting evidence trust gate for AeroSim data ingress.

This gate evaluates record-level quality and provenance before records are
eligible for calibration. It does not infer physical damage from sensor
anomalies; inspection-driven damage updates remain in inspection.py.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

ACCEPT = "accept"
REDUCED = "accept_reduced_confidence"
QUARANTINE = "quarantine"
REJECT = "reject"


def _parse_time(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None


def evaluate_record(record: dict[str, Any]) -> dict[str, Any]:
    """Return a deterministic trust decision and explainable score for one record."""
    reasons: list[str] = []
    provenance = str(record.get("provenance") or record.get("source") or "").lower()
    source_id = record.get("source_id") or record.get("source") or record.get("filename")
    provenance_missing = not provenance or not source_id
    if provenance_missing:
        reasons.append("Source provenance or source identifier is missing.")

    required = record.get("required_fields") or []
    payload = record.get("payload") or record
    missing = [key for key in required if payload.get(key) is None]
    if missing:
        reasons.append("Missing required fields: " + ", ".join(missing))

    values = record.get("numeric_values") or {}
    bounds = record.get("engineering_bounds") or {}
    invalid_numeric: list[str] = []
    for key, value in values.items():
        try:
            number = float(value)
        except (TypeError, ValueError):
            invalid_numeric.append(key)
            continue
        if not (number == number and abs(number) != float("inf")):
            invalid_numeric.append(key)
            continue
        bound = bounds.get(key)
        if bound and ((bound.get("min") is not None and number < bound["min"]) or
                      (bound.get("max") is not None and number > bound["max"])):
            reasons.append(f"{key} is outside the configured engineering plausibility bounds.")
    if invalid_numeric:
        reasons.append("Non-numeric or non-finite values: " + ", ".join(invalid_numeric))

    event_time = _parse_time(record.get("event_time") or record.get("timestamp"))
    if record.get("event_time") or record.get("timestamp"):
        if event_time is None:
            reasons.append("Timestamp cannot be parsed.")
    if record.get("expected_aircraft_id") and record.get("aircraft_id") != record["expected_aircraft_id"]:
        reasons.append("Aircraft identity does not match the target aircraft.")
    if record.get("expected_component_id") and record.get("component_id") != record["expected_component_id"]:
        reasons.append("Component identity does not match the target component.")
    if record.get("expected_flight_id") and record.get("flight_id") != record["expected_flight_id"]:
        reasons.append("Flight identity does not match the target flight.")
    if record.get("duplicate"):
        reasons.append("Duplicate source record detected.")

    score = 1.0
    if not provenance or not source_id:
        score -= 0.25
    if missing:
        score -= min(0.5, 0.15 * len(missing))
    if record.get("sensor_quality") in ("degraded", "low"):
        score -= 0.2
        reasons.append("Sensor quality is marked degraded.")
    if record.get("cross_source_conflict"):
        score -= 0.25
        reasons.append("Conflicting values were reported by another source.")
    score = max(0.0, min(1.0, score))

    hard_failure = bool(invalid_numeric or record.get("duplicate") or
                        any("identity does not match" in reason for reason in reasons) or
                        any("outside the configured" in reason for reason in reasons))
    if hard_failure:
        decision = REJECT
    elif record.get("cross_source_conflict") or score < 0.45:
        decision = QUARANTINE
    elif provenance_missing or score < 0.8 or missing:
        decision = REDUCED
    else:
        decision = ACCEPT
    return {
        "decision": decision,
        "score": round(score, 3),
        "reasons": reasons or ["Provenance, completeness, identity and configured plausibility checks passed."],
        "eligible_for_operational_calibration": decision in (ACCEPT, REDUCED),
        "eligible_for_damage_update": False,
        "damage_update_note": "Operational/sensor trust decisions never establish component damage; quantitative inspection evidence is required.",
    }


def evaluate_batch(records: list[dict[str, Any]]) -> dict[str, Any]:
    evaluated = [{"record_id": r.get("record_id") or r.get("id"), **evaluate_record(r)} for r in records]
    return {
        "total": len(evaluated),
        "counts": {decision: sum(1 for x in evaluated if x["decision"] == decision)
                   for decision in (ACCEPT, REDUCED, QUARANTINE, REJECT)},
        "records": evaluated,
    }
