"""
Digital-twin lifecycle for an individual component instance.

    historical records → twin initialisation (chronological replay)
    → upcoming-flight conditions (scheduled → comparable history → estimate)
    → immutable pre-flight prediction → actual observation → reconciliation
    → Stage A / Stage B / Stage C updates → commit as-flown state → next flight

Leakage rule: a prediction for flight N uses only information whose event_time
is earlier than flight N (twin state, scheduled info, earlier completed flights).
"""
from __future__ import annotations

import copy
import hashlib
import json
from typing import Any

import numpy as np

from ..db import Database, now_iso
from ..engine.base import EngineError
from ..engine.base import EngineError
from ..engine.fatigue import rainflow_bins
from ..engine.registry import DEFAULT_RESPONSE_PARAMS, get_model
from ..engine.response import MISSION_PRESETS, build_flight_loading
from .components import mission_from_dict, param_values, reference_loading, require_model_component, response_values
from .model_history import record_update, snapshot_component
from .simulation import simulate_sequence
from .uncertainty import monte_carlo

CONDITION_FIELDS = ["duration_min", "landing_cycles", "load_factor", "load_variation", "manoeuvre_intensity", "temperature_c", "pressure_factor", "vibration_level", "environment", "operating_intensity"]
ENGINEERING_DEFAULTS = {"duration_min": 120.0, "landing_cycles": 1, "load_factor": 1.0, "load_variation": 0.10, "manoeuvre_intensity": 1.0, "temperature_c": 15.0, "pressure_factor": 1.0, "vibration_level": 1.0, "environment": "benign", "operating_intensity": 1.0}
DEFAULT_SD = {"duration_min": 10.0, "load_factor": 0.08, "load_variation": 0.04, "manoeuvre_intensity": 0.3, "temperature_c": 5.0, "pressure_factor": 0.04, "vibration_level": 0.15, "operating_intensity": 0.06}


def component_actual_conditions(db: Database, component_id: str, flight: dict[str, Any]) -> dict[str, Any]:
    """Merge a component-specific, flight-linked operating summary into the as-flown conditions.

    The uploaded record is accepted only when the importer has linked it to the same
    aircraft and flight date. It supplements flight.actual; it never creates a flight
    or a sensor observation.
    """
    actual = dict(flight.get("actual") or {})
    records = db.list("operational_records", {"component_id": component_id, "flight_id": flight["id"]})
    if len(records) > 1:
        raise EngineError(f"Multiple operational summaries are linked to component {component_id} on flight {flight['id']}; resolve the duplicate before replay.")
    if records:
        record = records[0]
        if record.get("aircraft_id") != flight.get("aircraft_id") or record.get("operational_date") != flight.get("flight_date"):
            raise EngineError(f"Operational summary {record['id']} does not match the linked flight's aircraft/date; correct the source record before replay.")
        values = record.get("conditions") or {}
        for key in ("duration_min", "landing_cycles", "load_factor", "load_variation", "manoeuvre_intensity", "temperature_c", "pressure_factor", "vibration_level", "operating_intensity"):
            value = values.get(key)
            if value is not None:
                actual[key] = value
        if record.get("environment"):
            actual["environment"] = record["environment"]
        actual_provenance = actual.setdefault("_provenance", {})
        for key, value in values.items():
            if value is not None:
                actual_provenance[key] = {"source": record.get("source"), "record_id": record["id"], "provenance": record.get("provenance")}
        if record.get("environment"):
            actual_provenance["environment"] = {"source": record.get("source"), "record_id": record["id"], "provenance": record.get("provenance")}
        actual["_operational_record_id"] = record["id"]
    return actual


def mapped_load_history(db: Database, component_id: str, flight_id: str) -> dict[str, Any] | None:
    """Return the single user-mapped critical-section stress trace for a specific flight."""
    records = [
        row for row in db.list("load_histories", {"component_id": component_id, "flight_id": flight_id})
        if row.get("stress_basis") == "critical_net_section" and row.get("automatic_twin_replay") is True
    ]
    if len(records) > 1:
        raise EngineError(f"Multiple critical-net-section stress traces are linked to component {component_id} on flight {flight_id}; keep one authoritative trace.")
    return records[0] if records else None



# ----------------------------------------------------------------- upcoming-flight conditions
def resolve_conditions(db: Database, component: dict[str, Any], flight: dict[str, Any]) -> dict[str, Any]:
    """Priority 1 scheduled info → Priority 2 comparable completed flights (earlier only) → Priority 3 engineering estimate."""
    model = get_model(component["model_type"])
    relevant = set(model.relevant_mission_inputs()) | {"landing_cycles", "environment"}
    sched = flight.get("scheduled") or {}
    conditions: dict[str, Any] = {}
    provenance: dict[str, str] = {}
    uncertainty: dict[str, float | None] = {}
    notes: list[str] = []

    # earlier completed flights of the same aircraft (strictly before this flight) with actual data
    earlier = [f for f in db.list("flights", {"aircraft_id": flight["aircraft_id"]}) if f.get("status") == "completed" and f["event_time"] < flight["event_time"]]
    earlier_actual = {f["id"]: component_actual_conditions(db, component["id"], f) for f in earlier}
    earlier = [f for f in earlier if earlier_actual[f["id"]]]
    same_route = [f for f in earlier if f.get("route_or_mission") == flight.get("route_or_mission")]
    pool, pool_label = (same_route, "same route") if len(same_route) >= 2 else ((earlier, "all routes") if len(earlier) >= 3 else ([], "none"))

    for field in CONDITION_FIELDS:
        if field not in relevant and field not in ("duration_min",):
            continue
        # Priority 1: scheduled information
        if field in sched and sched[field] is not None:
            conditions[field] = sched[field]; provenance[field] = "scheduled"; uncertainty[field] = None
            continue
        if field == "temperature_c" and sched.get("expected_temperature_c") is not None:
            conditions[field] = sched["expected_temperature_c"]; provenance[field] = "scheduled (forecast)"; uncertainty[field] = 2.5
            continue
        if field == "environment" and sched.get("expected_environment"):
            conditions[field] = sched["expected_environment"]; provenance[field] = "scheduled"; uncertainty[field] = None
            continue
        if field == "load_factor" and sched.get("payload_fraction") is not None:
            from .history import planned_load_factor

            conditions[field] = planned_load_factor(sched["payload_fraction"]); provenance[field] = "derived from planned payload (documented relation 0.85 + 0.20·payload)"; uncertainty[field] = 0.04
            continue
        # Priority 2: comparable historical flights
        vals = [earlier_actual[f["id"]][field] for f in pool if field in earlier_actual[f["id"]]]
        if vals and field != "environment":
            arr = np.array(vals, dtype=float)
            conditions[field] = round(float(np.median(arr)), 4)
            provenance[field] = f"historical comparable flights ({pool_label}, n={len(vals)})"
            uncertainty[field] = round(float(np.std(arr, ddof=1)) if len(arr) > 1 else DEFAULT_SD.get(field, 0.0), 4)
            continue
        if vals and field == "environment":
            conditions[field] = max(set(vals), key=vals.count); provenance[field] = f"historical comparable flights ({pool_label})"; uncertainty[field] = None
            continue
        # Priority 3: engineering estimate
        conditions[field] = ENGINEERING_DEFAULTS[field]
        provenance[field] = "engineering estimate (documented default)"
        uncertainty[field] = DEFAULT_SD.get(field)
        notes.append(f"{field}: no scheduled value and no comparable flight — engineering default used.")
    return {"conditions": conditions, "provenance": provenance, "uncertainty": uncertainty, "comparables_used": [f["id"] for f in pool], "comparable_basis": pool_label, "notes": notes, "estimated_fields": [k for k, v in provenance.items() if not v.startswith("scheduled")]}


def _input_data_version(db: Database, component_id: str, before_time: str) -> str:
    comp = db.get("components", component_id)
    obs = [o["id"] for o in db.list_fields("flight_records", ["id", "event_time"], {"component_id": component_id}) if (o.get("event_time") or "") < before_time]
    insp = [i["id"] for i in db.list_fields("inspections", ["id", "event_time", "inspection_date"], {"component_id": component_id}) if (i.get("event_time") or i.get("inspection_date") or "") < before_time]
    mnt = [m["id"] for m in db.list_fields("maintenance", ["id", "event_time"], {"component_id": component_id}) if (m.get("event_time") or "") < before_time]
    ops = [o["id"] for o in db.list_fields("operational_records", ["id", "event_time"], {"component_id": component_id}) if (o.get("event_time") or "") < before_time]
    loads = [h["id"] for h in db.list_fields("load_histories", ["id", "event_time", "stress_basis"], {"component_id": component_id}) if (h.get("event_time") or "") < before_time and h.get("stress_basis") == "critical_net_section"]
    h = hashlib.sha1(json.dumps({"obs": obs, "insp": insp, "mnt": mnt, "ops": ops, "loads": loads, "v": comp.get("model_version")}, sort_keys=True).encode()).hexdigest()[:10]
    return f"obs{len(obs)}-insp{len(insp)}-mnt{len(mnt)}-ops{len(ops)}-load{len(loads)}-{h}"


# ----------------------------------------------------------------- pre-flight prediction
def predict_flight(db: Database, component_id: str, flight_id: str, mc_samples: int = 0, seed: int = 42, allow_completed: bool = False) -> dict[str, Any]:
    comp = require_model_component(db, component_id)
    flight = db.get("flights", flight_id)
    if flight is None:
        raise KeyError("Flight not found")
    if comp.get("lifecycle_status") == "retired" and (flight.get("event_time") or "") >= (comp.get("retired_at") or "9999"):
        raise EngineError(f"Component {component_id} was retired before flight {flight_id}; use the replacement component instance.")
    if flight["aircraft_id"] != comp.get("aircraft_id"):
        raise EngineError(f"Flight {flight_id} belongs to {flight['aircraft_id']}, not to the component's aircraft {comp.get('aircraft_id')}.")
    if flight["status"] == "completed" and not allow_completed:
        raise EngineError(f"Flight {flight_id} is already completed; a pre-flight prediction can only be made for a scheduled flight (or in chronological replay).")
    existing = db.list_fields("predictions", ["id"], {"component_id": component_id, "flight_id": flight_id})
    if existing:
        raise EngineError(f"A pre-flight prediction for {component_id} on {flight_id} already exists ({existing[0]['id']}); predictions are immutable.")
    res = resolve_conditions(db, comp, flight)
    mission = {"profile": "custom", "name": f"{flight_id} {flight.get('route_or_mission', '')}", **res["conditions"]}
    body = simulate_sequence(comp, [mission])
    unc = monte_carlo(comp, [mission], n_samples=int(mc_samples), seed=seed) if mc_samples and mc_samples >= 10 else None
    f = body["flights"][0]
    m = body["missions"][0]
    pred = {
        "component_id": component_id,
        "aircraft_id": comp["aircraft_id"],
        "component_identity_snapshot": {k: comp.get(k) for k in ("id", "manufacturer", "part_number", "serial_number", "installation_date")},
        "flight_id": flight_id,
        "flight_sequence": flight["sequence"],
        "flight_event_time": flight["event_time"],
        "prediction_timestamp": now_iso(),
        "model_version": comp.get("model_version", 1),
        "input_data_version": _input_data_version(db, component_id, flight["event_time"]),
        "parameters": body["parameters_used"],
        "response_params": body["response_params_used"],
        "state_before": body["initial_state"],
        "conditions": res["conditions"],
        "condition_provenance": res["provenance"],
        "condition_uncertainty": res["uncertainty"],
        "comparables_used": res["comparables_used"],
        "assumptions": res["notes"] + [f"Conditions {', '.join(res['estimated_fields'])} are estimated, not confirmed." if res["estimated_fields"] else "All conditions taken from the schedule."],
        "predicted": {
            "increments": f["increments"], "state_after": f["state_after"], "outputs": f["outputs"], "remaining_margin": f["remaining_margin"],
            "threshold_status": f["threshold_status"], "threshold_detail": f["threshold_detail"], "stress_bins": m["stress_bins"], "max_stress_mpa": m["max_stress_mpa"],
            "peak_temperature_k": m["peak_temperature_k"], "pressure_cycles": m["pressure_cycles"], "remaining_life": body["remaining_life"], "sn_breakdown": m.get("sn_breakdown"),
        },
        "predicted_channels": m.get("predicted_channels"),
        "uncertainty": unc,
        "threshold_crossing_fraction": unc["threshold_crossing_fraction"] if unc else None,
        "status": "pending",
        "immutable": True,
        "provenance": "simulation",
    }
    pred = db.insert("predictions", pred, "pred")
    db.log_activity("prediction", f"Pre-flight prediction {pred['id']} stored for {component_id} on {flight_id} (model v{pred['model_version']}).", {"prediction_id": pred["id"], "component_id": component_id, "flight_id": flight_id})
    return pred


def next_scheduled_flight(db: Database, component_id: str) -> dict[str, Any] | None:
    comp = db.get("components", component_id)
    if comp is None:
        raise KeyError("Component not found")
    if comp.get("lifecycle_status") == "retired":
        return None
    predicted = {p["flight_id"] for p in db.list_fields("predictions", ["flight_id"], {"component_id": component_id})}
    flights = sorted([f for f in db.list("flights", {"aircraft_id": comp.get("aircraft_id")}) if f["status"] == "scheduled"], key=lambda f: f["event_time"])
    for f in flights:
        if f["id"] not in predicted:
            return f
    return None


# ----------------------------------------------------------------- as-flown commit
def as_flown_step(db: Database, comp: dict[str, Any], flight: dict[str, Any]):
    """Re-run physics with flight actuals plus explicitly linked component operating/stress histories."""
    actual = component_actual_conditions(db, comp["id"], flight)
    if not actual:
        raise EngineError("Flight has no actual recorded conditions or linked operational summary.")
    model = get_model(comp["model_type"])
    params = param_values(comp)
    mission = mission_from_dict({"profile": "custom", **{k: v for k, v in actual.items() if k in CONDITION_FIELDS}})
    loading = build_flight_loading(comp["model_type"], params, response_values(comp), mission)
    provenance: dict[str, Any] = {}
    if actual.get("_operational_record_id"):
        provenance["operational_record_id"] = actual["_operational_record_id"]
        provenance["operational_fields"] = actual.get("_provenance", {})
        provenance["operational_source"] = actual.get("source")

    trace = mapped_load_history(db, comp["id"], flight["id"])
    if trace is not None:
        if comp["model_type"] != "engine_mount":
            raise EngineError("Critical-net-section stress replay is currently implemented only for engine_mount.")
        samples = trace.get("samples") or []
        stress = [float(sample["stress_mpa"]) for sample in samples]
        if len(stress) < 3:
            raise EngineError(f"Mapped load history {trace['id']} has fewer than 3 stress samples.")
        bins = rainflow_bins(stress)
        tensile_peak = max(stress)
        if not bins or tensile_peak <= 0:
            raise EngineError(f"Mapped load history {trace['id']} has no positive tensile stress cycles.")
        loading.stress_bins = bins
        loading.max_stress_mpa = float(tensile_peak)
        provenance["load_history_id"] = trace["id"]
        provenance["stress_basis"] = "critical_net_section"
        provenance["mapping_provenance"] = trace.get("mapping_provenance", "user_declared")
    loading.source_metadata = provenance
    return model.step(comp["state"], params, loading), loading


def commit_prediction(db: Database, prediction_id: str) -> dict[str, Any]:
    """Advance the twin state after the flight has taken place (as-flown model estimate; no damage evidence involved)."""
    pred = db.get("predictions", prediction_id)
    if pred is None:
        raise KeyError("Prediction not found")
    if pred.get("committed"):
        raise EngineError("This flight has already been incorporated into the component's operating history.")
    comp = require_model_component(db, pred["component_id"])
    flight = db.get("flights", pred["flight_id"])
    if flight is None or flight["status"] != "completed":
        raise EngineError("The flight has not been completed yet; the twin state can only be advanced after the flight.")
    if comp.get("lifecycle_status") == "retired" and (flight.get("event_time") or "") >= (comp.get("retired_at") or "9999"):
        raise EngineError(f"Component {comp['id']} was retired before flight {flight['id']}; its replacement must carry the later history.")
    step, loading = as_flown_step(db, comp, flight)
    comp["state"] = step.new_state
    comp["flights_since_damage_update"] = comp.get("flights_since_damage_update", 0) + 1
    source_metadata = getattr(loading, "source_metadata", {})
    comp.setdefault("flight_log", []).append({"flight_id": flight["id"], "sequence": flight["sequence"], "prediction_id": prediction_id, "as_flown_increments": step.increments, "state_after": step.new_state, "source_metadata": source_metadata, "ts": now_iso()})
    db.upsert("components", comp)
    pred["committed"] = True
    pred["as_flown"] = {"increments": step.increments, "state_after": step.new_state, "threshold_status": step.threshold_status, "source_metadata": source_metadata}
    if pred.get("status") != "reconciled":
        pred["reconciliation_status"] = "not_performed_no_sensor_observation"
    pred["status"] = "committed"
    db.upsert("predictions", pred)
    db.log_activity("commit", f"Flight {flight['id']} incorporated into {comp['id']} operating history (as-flown model estimate).", {"prediction_id": prediction_id, "component_id": comp["id"], "flight_id": flight["id"]})
    return comp


# ----------------------------------------------------------------- maintenance
def apply_maintenance(db: Database, maintenance_id: str) -> dict[str, Any]:
    rec = db.get("maintenance", maintenance_id)
    if rec is None:
        raise KeyError("Maintenance record not found")
    comp = require_model_component(db, rec["component_id"])
    model = get_model(comp["model_type"])
    before = snapshot_component(comp)
    changes: dict[str, dict[str, Any]] = {}
    kind = rec.get("repair_or_replacement", "none")
    applied = False
    if kind == "replacement":
        raise EngineError("A physical component replacement creates a new component instance. Use POST /api/components/{component_id}/replace; historical records on the retired serial number remain immutable.")
    elif kind == "repair" and rec.get("damage_after"):
        for k, v in rec["damage_after"].items():
            if k in comp["state"]:
                changes[k] = {"before": comp["state"][k], "after": v, "unit": "SI"}
                comp["state"][k] = v
        applied = bool(changes)
    if applied:
        comp["last_damage_update"] = {"quantity": next(iter(changes)), "value_after": changes[next(iter(changes))]["after"], "sigma_after": 0.0, "flights_at_update": comp["state"].get("flights", 0), "inspection_id": None, "maintenance_id": maintenance_id}
        comp["flights_since_damage_update"] = 0
    summary = f"Maintenance '{rec['activity']}' ({kind}) applied to the damage state." if applied else f"Maintenance '{rec['activity']}' recorded; no state change ({kind})."
    upd = record_update(db, comp, "B_damage_state" if applied else "C_rejected", "accept" if applied else "accept", {"type": "maintenance", "maintenance_id": maintenance_id, "reference": rec.get("maintenance_reference")}, changes, applied, summary, metrics={"before": before})
    rec["applied_in_history"] = True
    rec["update_id"] = upd["id"]
    db.upsert("maintenance", rec)
    return {"maintenance": rec, "update": upd, "component": db.get("components", comp["id"])}


# ----------------------------------------------------------------- chronological replay (twin initialisation)
def replay_history(db: Database, component_id: str, stage_a: bool = True, stage_b: bool = True, label: str = "initialisation") -> dict[str, Any]:
    """Reset the twin to its documented baseline and replay its own history chronologically.

    Returns per-flight metrics (forecast error, as-flown residual, state vs hidden truth when available).
    """
    from .inspection import damage_state_update
    from .reconciliation import apply_operational_update, reconcile_prediction

    comp = require_model_component(db, component_id)
    if comp.get("lifecycle_status") == "retired":
        raise EngineError("A retired component instance is read-only; its original historical replay is preserved.")
    # reset twin and purge derived records for this component
    for coll in ("predictions", "reconciliations", "model_updates"):
        for d in db.list(coll, {"component_id": component_id}):
            db.delete(coll, d["id"])
    for i in db.list("inspections", {"component_id": component_id}):
        i["update"] = None; i["applied_in_history"] = False
        db.upsert("inspections", i)
    for m in db.list("maintenance", {"component_id": component_id}):
        m["applied_in_history"] = False; m.pop("update_id", None)
        db.upsert("maintenance", m)
    comp["state"] = copy.deepcopy(comp.get("baseline_state") or comp["state"])
    comp["response_params"] = dict(DEFAULT_RESPONSE_PARAMS)
    comp["model_version"] = 1
    comp["version_history"] = []
    comp["flight_log"] = []
    comp["committed_flights"] = []
    comp["flights_since_damage_update"] = 0
    comp["last_damage_update"] = None
    comp["history_initialised"] = False
    for k, p in comp["parameters"].items():
        if p.get("provenance") == "calibrated":
            default = get_model(comp["model_type"]).default_parameters()[k]
            p["value"] = default.value; p["provenance"] = default.provenance
    db.upsert("components", comp)

    retirement_cutoff = comp.get("retired_at")
    flights = [f for f in db.list("flights", {"aircraft_id": comp["aircraft_id"]}) if f["status"] == "completed" and (not retirement_cutoff or f.get("event_time", "") < retirement_cutoff)]
    obs_by_flight = {o["flight_id"]: o for o in db.list("flight_records", {"component_id": component_id}) if o.get("flight_id")}
    operational_by_flight = {o["flight_id"]: o for o in db.list("operational_records", {"component_id": component_id}) if o.get("flight_id")}
    mapped_load_by_flight = {h["flight_id"]: h for h in db.list("load_histories", {"component_id": component_id}) if h.get("flight_id") and h.get("stress_basis") == "critical_net_section" and h.get("automatic_twin_replay") is True}
    events: list[tuple[str, int, str, dict]] = []
    for f in flights:
        if f["id"] in obs_by_flight or f["id"] in operational_by_flight or f["id"] in mapped_load_by_flight:
            events.append((f["event_time"], 0, "flight", f))
    for i in db.list("inspections", {"component_id": component_id}):
        event_time = i.get("event_time") or f"{i['inspection_date']}T14:00:00+00:00"
        if not retirement_cutoff or event_time < retirement_cutoff:
            events.append((event_time, 1, "inspection", i))
    for m in db.list("maintenance", {"component_id": component_id}):
        event_time = m.get("event_time") or f"{m['maintenance_date']}T15:00:00+00:00"
        if not retirement_cutoff or event_time < retirement_cutoff:
            events.append((event_time, 2, "maintenance", m))
    events.sort(key=lambda e: (e[0], e[1]))

    metrics: list[dict[str, Any]] = []
    key = {"engine_mount": "crack_length_m", "landing_gear": "miner_damage", "turbine_blade": "creep_strain", "hydraulic_actuator": "wear_indicator"}[comp["model_type"]]
    load_ch = "pressure_bar" if comp["model_type"] == "hydraulic_actuator" else "load_kN"
    for _t, _o, kind, doc in events:
        if kind == "flight":
            pred = predict_flight(db, component_id, doc["id"], mc_samples=0, allow_completed=True)
            obs = obs_by_flight.get(doc["id"])
            rec = reconcile_prediction(db, pred["id"]) if obs else None
            if rec is not None:
                decision = rec["gate"]["decision"]
                if stage_a:
                    apply_operational_update(db, rec["id"])
                else:
                    apply_operational_update(db, rec["id"], force_decision="reject")
                fc = rec["forecast"]["channels"].get(load_ch, {})
                af = rec["channels"].get(load_ch, {})
            else:
                # Operating summaries and mapped stress traces advance physical damage only.
                # They are not sensor residuals and must never calibrate Stage A.
                decision = "no_sensor_observation"
                fc = {}
                af = {}
            comp_after = commit_prediction(db, pred["id"])
            truth = obs.get("truth_state_after") if obs else None
            metrics.append({
                "flight_id": doc["id"], "sequence": doc["sequence"], "model_version": pred["model_version"],
                "forecast_rel_error": fc.get("relative_error"), "as_flown_rel_error": af.get("relative_error"),
                "gate": decision, "state_key": key, "twin_state": comp_after["state"].get(key), "truth_state": truth.get(key) if truth else None,
                "state_error": (comp_after["state"].get(key) - truth.get(key)) if truth else None,
                "predicted_state": pred["predicted"]["state_after"].get(key),
                "data_sources": (db.get("predictions", pred["id"]) or {}).get("as_flown", {}).get("source_metadata", {}),
            })
        elif kind == "inspection":
            if doc.get("quantity") and doc.get("measured_value") is not None:
                if stage_b:
                    damage_state_update(db, doc["id"])
                else:
                    doc["update"] = {"decision": "not_applied", "applied": False, "reasons": [f"Stage B disabled in '{label}' replay"], "update_id": None, "z_score": 0, "posterior_value": None, "posterior_sigma": None, "unit": doc.get("unit")}
            doc = db.get("inspections", doc["id"]) or doc
            doc["applied_in_history"] = True
            db.upsert("inspections", doc)
        else:
            if stage_b:
                apply_maintenance(db, doc["id"])
            else:
                doc["applied_in_history"] = True
                db.upsert("maintenance", doc)
    comp = db.get("components", component_id)
    comp["history_initialised"] = True
    comp["initialised_at"] = now_iso()
    comp["evidence_summary"] = {
        "completed_flights_with_observations": sum(1 for e in events if e[2] == "flight" and e[3]["id"] in obs_by_flight),
        "completed_flights_replayed": sum(1 for e in events if e[2] == "flight"),
        "completed_flights_without_sensor_observations": sum(1 for e in events if e[2] == "flight" and e[3]["id"] not in obs_by_flight),
        "operational_records": len(db.list("operational_records", {"component_id": component_id})),
        "load_histories": len(db.list("load_histories", {"component_id": component_id})),
        "mapped_load_histories": sum(1 for h in db.list("load_histories", {"component_id": component_id}) if h.get("stress_basis") == "critical_net_section" and h.get("automatic_twin_replay") is True),
        "inspections": sum(1 for e in events if e[2] == "inspection"),
        "maintenance_records": sum(1 for e in events if e[2] == "maintenance"),
        "applied_updates": sum(1 for u in db.list("model_updates", {"component_id": component_id}) if u["applied"]),
        "rejected_updates": sum(1 for u in db.list("model_updates", {"component_id": component_id}) if not u["applied"]),
        "baseline_provenance": comp.get("baseline_provenance", {}),
        "stage_a": stage_a, "stage_b": stage_b,
    }
    db.upsert("components", comp)
    db.log_activity("initialise", f"Twin {component_id} initialised from its own history ({comp['evidence_summary']['completed_flights_with_observations']} flights, {comp['evidence_summary']['inspections']} inspections, {comp['evidence_summary']['maintenance_records']} maintenance records) → model v{comp['model_version']}.", {"component_id": component_id})
    return {"component": comp, "metrics": metrics}


def initialise_all(db: Database) -> list[dict[str, Any]]:
    out = []
    for c in db.list("components"):
        if c.get("model_type") and c.get("lifecycle_status") != "retired":
            out.append({"component_id": c["id"], "model_version": replay_history(db, c["id"])["component"]["model_version"]})
    return out


def twin_status(db: Database, component_id: str) -> dict[str, Any]:
    """Dashboard summary for one component instance."""
    comp = db.get("components", component_id)
    if comp is None:
        raise KeyError("Component not found")
    preds = sorted(db.list("predictions", {"component_id": component_id}), key=lambda p: p["flight_event_time"])
    recs = db.list("reconciliations", {"component_id": component_id}, newest_first=True)
    obs = sorted(db.list("flight_records", {"component_id": component_id}), key=lambda o: o.get("event_time") or "")
    insp = sorted(db.list("inspections", {"component_id": component_id}), key=lambda i: i.get("event_time") or i["inspection_date"])
    mnt = db.list("maintenance", {"component_id": component_id})
    operational = db.list("operational_records", {"component_id": component_id})
    loads = db.list("load_histories", {"component_id": component_id})
    ups = [u for u in db.list("model_updates", {"component_id": component_id}, newest_first=True)]
    nxt = next_scheduled_flight(db, component_id) if comp.get("model_type") else None
    pending = [p for p in preds if p["status"] == "pending"]
    return {
        "component_id": component_id,
        "aircraft_id": comp.get("aircraft_id"),
        "history_initialised": comp.get("history_initialised", False),
        "evidence_summary": comp.get("evidence_summary"),
        "data_availability": {
            "observations": len(obs),
            "measured_channels": sorted({c for o in obs for c in o.get("measured_channels", [])}),
            "operational_records": len(operational),
            "load_histories": len(loads),
            "mapped_load_histories": sum(1 for h in loads if h.get("stress_basis") == "critical_net_section" and h.get("automatic_twin_replay") is True),
            "inspections": len(insp), "maintenance": len(mnt), "predictions": len(preds)
        },
        "latest_inspection": insp[-1] if insp else None,
        "next_scheduled_flight": nxt,
        "last_prediction": preds[-1] if preds else None,
        "pending_prediction": pending[-1] if pending else None,
        "last_observation": {k: obs[-1].get(k) for k in ("id", "flight_id", "event_time", "label", "provenance", "anomaly")} if obs else None,
        "last_reconciliation": {k: recs[0].get(k) for k in ("id", "flight_id", "gate", "summary", "forecast_summary", "applied", "final_decision", "model_version")} if recs else None,
        "latest_accepted_update": next((u for u in ups if u["applied"]), None),
        "next_prediction_status": "pending reconciliation" if pending else ("ready — next scheduled flight " + nxt["id"] if nxt else "no scheduled flight"),
    }
