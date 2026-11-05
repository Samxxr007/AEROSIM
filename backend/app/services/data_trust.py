"""Cross-cutting evidence trust gate for AeroSim data ingress.

Checks provenance, completeness, sensor quality, time ordering, identity,
cross-source agreement and configured engineering plausibility before records
are eligible for model calibration. It never authorises a damage-state update.
"""
from __future__ import annotations

import math
from datetime import datetime
from typing import Any

ACCEPT = "accept"
REDUCED = "accept_reduced_confidence"
QUARANTINE = "quarantine"
REJECT = "reject"


def evaluate_record(record: dict[str, Any]) -> dict[str, Any]:
    reasons: list[str] = []
    provenance = str(record.get("provenance") or record.get("source") or "").strip()
    source_id = record.get("source_id") or record.get("filename") or record.get("id")
    if not provenance or not source_id:
        reasons.append("Missing source provenance or stable source identifier.")

    required = record.get("required_fields") or []
    payload = record.get("payload") or record
    missing = [field for field in required if payload.get(field) is None]
    if missing:
        reasons.append("Missing required fields: " + ", ".join(missing))

    invalid: list[str] = []
    out_of_bounds: list[str] = []
    for key, value in (record.get("numeric_values") or {}).items():
        try:
            number = float(value)
        except (TypeError, ValueError):
            invalid.append(key)
            continue
        if not math.isfinite(number):
            invalid.append(key)
            continue
        bound = (record.get("engineering_bounds") or {}).get(key)
        if bound and ((bound.get("min") is not None and number < bound["min"]) or
                      (bound.get("max") is not None and number > bound["max"])):
            out_of_bounds.append(key)
    if invalid:
        reasons.append("Non-numeric or non-finite values: " + ", ".join(invalid))
    if out_of_bounds:
        reasons.append("Values outside configured engineering bounds: " + ", ".join(out_of_bounds))

    timestamp = record.get("event_time") or record.get("timestamp")
    if timestamp:
        try:
            datetime.fromisoformat(str(timestamp).replace("Z", "+00:00"))
        except ValueError:
            reasons.append("Timestamp is not a valid ISO-8601 value.")
    for field in ("aircraft_id", "component_id", "flight_id"):
        expected = record.get("expected_" + field)
        if expected and record.get(field) != expected:
            reasons.append(f"{field} does not match the target record.")
    if record.get("duplicate"):
        reasons.append("Duplicate record detected.")

    score = 1.0
    if not provenance or not source_id:
        score -= 0.25
    score -= min(0.5, 0.15 * len(missing))
    if record.get("sensor_quality") in ("low", "degraded"):
        score -= 0.2
        reasons.append("Sensor quality is marked low or degraded.")
    if record.get("cross_source_conflict"):
        score -= 0.25
        reasons.append("Conflicting values reported by another evidence source.")
    score = round(max(0.0, score), 3)

    hard_reject = bool(invalid or out_of_bounds or record.get("duplicate") or
                       any("does not match" in x for x in reasons))
    if hard_reject:
        decision = REJECT
    elif record.get("cross_source_conflict") or score < 0.45:
        decision = QUARANTINE
    elif not provenance or not source_id or missing or score < 0.8:
        decision = REDUCED
    else:
        decision = ACCEPT
    return {
        "decision": decision,
        "score": score,
        "reasons": reasons or ["Provenance, required fields, identity and configured plausibility checks passed."],
        "eligible_for_operational_calibration": decision in (ACCEPT, REDUCED),
        "eligible_for_damage_update": False,
        "damage_update_note": "Sensor/operational evidence cannot directly update crack length or other physical damage; quantitative, reliable inspection evidence is required.",
    }


def evaluate_batch(records: list[dict[str, Any]]) -> dict[str, Any]:
    evaluated = [{"record_id": r.get("record_id") or r.get("id"), **evaluate_record(r)} for r in records]
    return {
        "total": len(evaluated),
        "counts": {decision: sum(row["decision"] == decision for row in evaluated)
                   for decision in (ACCEPT, REDUCED, QUARANTINE, REJECT)},
        "records": evaluated,
    }
