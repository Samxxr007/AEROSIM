"""Versioned, auditable model-update history (Stage E)."""
from __future__ import annotations

import copy
from typing import Any

from ..db import Database


def record_update(
    db: Database,
    component: dict[str, Any],
    stage: str,
    decision: str,
    evidence: dict[str, Any],
    changes: dict[str, dict[str, Any]],
    applied: bool,
    summary: str,
    metrics: dict[str, Any] | None = None,
    flight_id: str | None = None,
) -> dict[str, Any]:
    """Persist a model-update record. If applied, bump the component version."""
    before_version = component.get("model_version", 1)
    after_version = before_version + 1 if applied else before_version
    rec = {
        "component_id": component["id"],
        "aircraft_id": component.get("aircraft_id"),
        "flight_id": flight_id or (evidence or {}).get("flight_id"),
        "update_type": {"A_operational": "operational_model", "B_damage_state": "damage_state", "C_rejected": "not_applied"}.get(stage, stage),
        "stage": stage,  # 'A_operational' | 'B_damage_state' | 'C_rejected'
        "decision": decision,  # accept | accept_reduced_confidence | request_more_evidence | reject
        "applied": applied,
        "version_before": before_version,
        "version_after": after_version,
        "evidence": evidence,
        "changes": changes,  # {param: {before, after, unit?}}
        "previous_parameters": {k: v.get("before") for k, v in changes.items()},
        "updated_parameters": {k: v.get("after") for k, v in changes.items()},
        "evidence_used": evidence,
        "update_quality": decision,
        "acceptance_status": "applied" if applied else "not_applied",
        "metrics": metrics or {},
        "summary": summary,
    }
    rec = db.insert("model_updates", rec, "upd")
    if applied:
        component["model_version"] = after_version
        hist = component.setdefault("version_history", [])
        hist.append({"version": after_version, "update_id": rec["id"], "stage": stage, "timestamp": rec["created_at"], "summary": summary})
        db.upsert("components", component)
    db.log_activity("model_update", f"{stage} {decision} for {component['id']} (v{before_version}→v{after_version}, applied={applied}).", {"update_id": rec["id"], "component_id": component["id"]})
    return rec


def timeline(db: Database, component_id: str | None = None) -> list[dict[str, Any]]:
    """Chronological learning timeline: simulations, observations, reconciliations, inspections, updates."""
    events: list[dict[str, Any]] = []
    where = {"component_id": component_id} if component_id else None
    for r in db.list("simulation_runs", where):
        events.append({"ts": r["created_at"], "seq": r.get("seq", 0), "type": "simulation", "id": r["id"], "component_id": r["component_id"], "title": f"What-if simulation (model v{r['model_version']})", "detail": f"{r['n_flights']} flights · {r['threshold_status']} · not an actual flight", "version": r["model_version"]})
    for p in db.list("predictions", where):
        events.append({"ts": p["created_at"], "seq": p.get("seq", 0), "type": "prediction", "id": p["id"], "component_id": p["component_id"], "flight_id": p["flight_id"], "title": f"Pre-flight prediction for {p['flight_id']} (model v{p['model_version']})", "detail": f"{len(p.get('assumptions', []))} assumption note(s) · status {p.get('status')}", "version": p["model_version"]})
    for m in db.list("maintenance", where):
        events.append({"ts": m.get("event_time") or m["created_at"], "seq": m.get("seq", 0), "type": "maintenance", "id": m["id"], "component_id": m["component_id"], "title": f"Maintenance — {m['activity']}", "detail": f"{m.get('repair_or_replacement')} · ref {m.get('maintenance_reference')}"})
    for o in db.list("flight_records", where):
        events.append({"ts": o.get("event_time") or o["created_at"], "seq": o.get("seq", 0), "type": "observation", "id": o["id"], "component_id": o["component_id"], "flight_id": o.get("flight_id"), "title": f"Actual-flight observation ({o.get('flight_id')})", "detail": o.get("label") if o.get("provenance") == "synthetic_ground_truth" else f"provenance: {o.get('provenance')}", "anomaly": o.get("anomaly")})
    for rc in db.list("reconciliations", where):
        events.append({"ts": rc["created_at"], "seq": rc.get("seq", 0), "type": "reconciliation", "id": rc["id"], "component_id": rc["component_id"], "flight_id": rc.get("flight_id"), "title": f"Prediction reconciliation ({rc.get('flight_id')})", "detail": f"decision: {rc['gate']['decision']} · forecast error {rc['summary'].get('forecast_mean_relative_error', float('nan')):.1%} · response error {rc['summary']['mean_relative_error']:.1%}", "decision": rc["gate"]["decision"], "relative_error": rc["summary"]["mean_relative_error"], "forecast_error": rc["summary"].get("forecast_mean_relative_error")})
    for i in db.list("inspections", where):
        events.append({"ts": i.get("event_time") or i["created_at"], "seq": i.get("seq", 0), "type": "inspection", "id": i["id"], "component_id": i["component_id"], "title": f"Inspection — {i.get('method_label') or i['method']} ({i.get('inspection_date')})", "detail": f"{i.get('observed_defect')}: {i.get('measured_value') if i.get('measured_value') is not None else 'no measurement'} {i.get('unit') or ''}", "decision": (i.get('update') or {}).get('decision')})
    for u in db.list("model_updates", where):
        events.append({"ts": u["created_at"], "seq": u.get("seq", 0), "type": "model_update", "id": u["id"], "component_id": u["component_id"], "flight_id": u.get("flight_id"), "title": f"Model update — {u.get('update_type', u['stage'])}", "detail": f"{u['decision']} · v{u['version_before']}→v{u['version_after']}" + ("" if u["applied"] else " (not applied)"), "decision": u["decision"], "applied": u["applied"], "version": u["version_after"]})
    events.sort(key=lambda e: (e.get("seq", 0), e["ts"]))
    return events


def snapshot_component(component: dict[str, Any]) -> dict[str, Any]:
    return copy.deepcopy({"model_version": component.get("model_version"), "response_params": component.get("response_params"), "state": component.get("state"), "parameters": {k: v["value"] for k, v in component.get("parameters", {}).items()}})
