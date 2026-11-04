"""FastAPI routers — thin, typed wrappers around the services.

Primary workflow:  /aircraft · /components · /flights · /predictions · /observations · /reconciliations ·
                   /inspections · /maintenance · /twin/* · /model-history · /validation
Secondary (what-if): /scenarios · /simulations (never change the twin state)
"""
from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, File, HTTPException, Query, UploadFile
from fastapi.responses import PlainTextResponse

from ..db import Database, get_db, sanitize
from ..engine.base import EngineError
from ..engine.registry import DEFAULT_RESPONSE_PARAMS, MODEL_REGISTRY, list_models
from ..engine.response import CHANNEL_UNITS, DEFAULT_PHASE_FRACTIONS, ENVIRONMENT_FACTORS, MISSION_PRESETS, PHASES, PHASE_TABLES
from ..schemas import (ApplyUpdateRequest, CompareRequest, CompleteFlightRequest, ComponentIn, InspectionIn, MaintenanceIn, ManualObservationRequest,
                       PredictRequest, ReconcileRequest, ScenarioIn, ScheduledFlightIn, SettingsIn, SimulationRequest)
from ..services import csv_import, demo, ground_truth, history, inspection, model_history, phm2019, playback, reconciliation, seed, simulation, twin, validation
from ..services.components import component_assessment

router = APIRouter()


def _db() -> Database:
    return get_db()


def _wrap(fn, *a, **kw):
    try:
        return sanitize(fn(*a, **kw))
    except KeyError as exc:
        raise HTTPException(404, str(exc.args[0] if exc.args else exc)) from exc
    except (EngineError, ValueError) as exc:
        raise HTTPException(422, str(exc)) from exc


def _strip_truth(o: dict[str, Any]) -> dict[str, Any]:
    o = dict(o)
    o.pop("truth_state_after", None)
    return o


# ----------------------------------------------------------------- meta / overview
@router.get("/health")
def health():
    return {"status": "ok", "components": _db().count("components")}


@router.get("/overview")
def overview():
    db = _db()
    comps = db.list("components")
    assessed = []
    for c in comps:
        a = component_assessment(c)
        st = twin.twin_status(db, c["id"]) if c.get("model_type") else None
        assessed.append({
            "id": c["id"], "name": c["name"], "system": c["system"], "aircraft_id": c.get("aircraft_id"), "position": c.get("position"), "model_type": c["model_type"], "model_version": c.get("model_version"), "provenance": c.get("provenance"),
            "status": a["status"], "review_required": a["review_required"], "min_margin": a.get("min_margin"), "remaining_life": (a.get("remaining_life") or {}).get("governing_remaining_flights"),
            "governing_mechanism": (a.get("remaining_life") or {}).get("governing_mechanism"), "state": c.get("state", {}), "history_initialised": c.get("history_initialised", False),
            "data_availability": st["data_availability"] if st else None,
            "latest_inspection": {k: st["latest_inspection"].get(k) for k in ("inspection_date", "method_label", "observed_defect", "measured_value", "unit", "measurement_uncertainty")} if st and st["latest_inspection"] else None,
            "next_scheduled_flight": {k: st["next_scheduled_flight"].get(k) for k in ("id", "flight_date", "route_or_mission")} if st and st["next_scheduled_flight"] else None,
            "last_prediction": {k: st["last_prediction"].get(k) for k in ("id", "flight_id", "status", "model_version", "threshold_crossing_fraction")} if st and st["last_prediction"] else None,
            "last_observation": st["last_observation"] if st else None,
            "last_reconciliation": st["last_reconciliation"] if st else None,
            "latest_accepted_update": {k: st["latest_accepted_update"].get(k) for k in ("id", "stage", "decision", "version_after", "summary", "created_at")} if st and st["latest_accepted_update"] else None,
            "next_prediction_status": st["next_prediction_status"] if st else None,
        })
    updates = db.list("model_updates", newest_first=True)
    recs = db.list("reconciliations", newest_first=True)
    flights = db.list("flights")
    return {
        "aircraft": db.list("aircraft"),
        "counts": {
            "components": len(comps), "modelled_components": sum(1 for c in comps if c.get("model_type")), "review_required": sum(1 for a in assessed if a["review_required"]),
            "flights_completed": sum(1 for f in flights if f["status"] == "completed"), "flights_scheduled": sum(1 for f in flights if f["status"] == "scheduled"),
            "predictions": db.count("predictions"), "observations": db.count("flight_records"), "reconciliations": len(recs), "inspections": db.count("inspections"), "maintenance": db.count("maintenance"),
            "model_updates_applied": sum(1 for u in updates if u["applied"]), "model_updates_rejected": sum(1 for u in updates if not u["applied"]), "what_if_runs": db.count("simulation_runs"),
        },
        "latest_update": updates[0] if updates else None,
        "latest_reconciliation": {k: recs[0].get(k) for k in ("id", "component_id", "flight_id", "gate", "summary", "created_at", "model_version")} if recs else None,
        "components": assessed,
        "recent_activity": db.list("activity", newest_first=True, limit=14),
        "demo": next((s for s in db.list("settings") if s.get("id", "").startswith("demo_")), None),
        "data_provenance_note": "All fleet records are synthetic demonstration data unless tagged 'uploaded' or 'manual'. Synthetic observations are labelled SYNTHETIC ACTUAL-FLIGHT OBSERVATION — SIMULATED GROUND TRUTH.",
    }


@router.get("/models")
def models():
    return {"models": list_models(), "default_response_params": DEFAULT_RESPONSE_PARAMS}


@router.get("/missions/presets")
def mission_presets():
    return {"presets": MISSION_PRESETS, "phases": PHASES, "default_phase_fractions": DEFAULT_PHASE_FRACTIONS, "environments": list(ENVIRONMENT_FACTORS), "phase_tables": PHASE_TABLES, "channel_units": CHANNEL_UNITS,
            "relevant_inputs": {k: m.relevant_mission_inputs() for k, m in MODEL_REGISTRY.items()}}


@router.get("/catalogue")
def catalogue():
    return {"systems": seed.SYSTEM_CATEGORIES, "failure_catalogue": seed.FAILURE_CATALOGUE, "implemented": seed.IMPLEMENTED_MECHANISMS}


# ----------------------------------------------------------------- aircraft
@router.get("/aircraft")
def list_aircraft():
    db = _db()
    out = []
    for a in db.list("aircraft"):
        comps = db.list("components", {"aircraft_id": a["id"]})
        fl = db.list("flights", {"aircraft_id": a["id"]})
        out.append({**a, "components": [{"id": c["id"], "name": c["name"], "model_type": c["model_type"], "position": c.get("position")} for c in comps], "flights_completed": sum(1 for f in fl if f["status"] == "completed"), "flights_scheduled": sum(1 for f in fl if f["status"] == "scheduled")})
    return out


# ----------------------------------------------------------------- components
@router.get("/components")
def list_components(system: str | None = None, q: str | None = None, modelled: bool | None = None, aircraft_id: str | None = None):
    db = _db()
    out = []
    for c in db.list("components"):
        if system and c["system"] != system:
            continue
        if aircraft_id and c.get("aircraft_id") != aircraft_id:
            continue
        if modelled is not None and bool(c.get("model_type")) != modelled:
            continue
        if q and q.lower() not in f"{c['id']} {c['name']} {c.get('material', '')} {c.get('description', '')} {c.get('serial_number', '')} {c.get('part_number', '')}".lower():
            continue
        out.append({**c, "assessment": component_assessment(c)})
    return out


@router.get("/components/{component_id}")
def get_component(component_id: str):
    db = _db()
    c = db.get("components", component_id)
    if c is None:
        raise HTTPException(404, "Component not found")
    model = MODEL_REGISTRY.get(c["model_type"]) if c.get("model_type") else None
    return sanitize({
        **c,
        "assessment": component_assessment(c),
        "twin": twin.twin_status(db, component_id) if model else None,
        "model": {"display_name": model.display_name, "mechanisms": model.mechanisms, "equations": model.equations(), "relevant_mission_inputs": model.relevant_mission_inputs(), "uncertain_parameters": model.uncertain_parameters()} if model else None,
        "inspections": db.list("inspections", {"component_id": component_id}, newest_first=True),
        "maintenance": db.list("maintenance", {"component_id": component_id}, newest_first=True),
        "model_updates": db.list("model_updates", {"component_id": component_id}, newest_first=True),
        "predictions": [{k: p.get(k) for k in ("id", "flight_id", "flight_sequence", "model_version", "status", "prediction_timestamp", "threshold_crossing_fraction", "committed")} for p in db.list("predictions", {"component_id": component_id}, newest_first=True)],
        "runs": [{k: r[k] for k in ("id", "label", "n_flights", "threshold_status", "model_version", "created_at")} for r in db.list("simulation_runs", {"component_id": component_id}, newest_first=True, limit=10)],
    })


@router.get("/components/{component_id}/history")
def component_history(component_id: str):
    """Component Historical Profile: its own sensor, inspection and maintenance history (observations summarised)."""
    db = _db()
    c = db.get("components", component_id)
    if c is None:
        raise HTTPException(404, "Component not found")
    flights = {f["id"]: f for f in db.list("flights", {"aircraft_id": c.get("aircraft_id")})}
    obs_rows = []
    import numpy as np

    for o in db.list("flight_records", {"component_id": component_id}):
        ch = o["channels"]
        summary = {}
        for name in o.get("measured_channels", []):
            arr = np.array([np.nan if v is None else v for v in ch.get(name, [])], dtype=float)
            if arr.size and not np.all(np.isnan(arr)):
                summary[name] = {"mean": float(np.nanmean(arr)), "max": float(np.nanmax(arr)), "min": float(np.nanmin(arr)), "missing_fraction": float(np.mean(np.isnan(arr)))}
        f = flights.get(o.get("flight_id") or "", {})
        obs_rows.append({"id": o["id"], "flight_id": o.get("flight_id"), "flight_date": f.get("flight_date"), "route": f.get("route_or_mission"), "event_time": o.get("event_time"), "provenance": o.get("provenance"), "label": o.get("label"), "anomaly": o.get("anomaly"), "measured_channels": o.get("measured_channels", []), "summary": summary, "actual_conditions": f.get("actual")})
    obs_rows.sort(key=lambda r: r.get("event_time") or "")
    return sanitize({
        "component_id": component_id, "aircraft_id": c.get("aircraft_id"), "baseline_state": c.get("baseline_state"), "baseline_provenance": c.get("baseline_provenance"), "baseline_date": c.get("baseline_date"),
        "installation_date": c.get("installation_date"), "part_number": c.get("part_number"), "serial_number": c.get("serial_number"),
        "observations": obs_rows,
        "operational_records": sorted(db.list("operational_records", {"component_id": component_id}), key=lambda r: r.get("event_time") or r.get("operational_date") or ""),
        "load_histories": sorted(db.list("load_histories", {"component_id": component_id}), key=lambda r: r.get("event_time") or r.get("created_at") or ""),
        "inspections": sorted(db.list("inspections", {"component_id": component_id}), key=lambda i: i.get("event_time") or i["inspection_date"]),
        "maintenance": sorted(db.list("maintenance", {"component_id": component_id}), key=lambda m: m.get("event_time") or m["maintenance_date"]),
        "flight_log": c.get("flight_log", []),
        "evidence_summary": c.get("evidence_summary"),
        "measured_quantities": sorted({ch for o in obs_rows for ch in o["measured_channels"]}),
        "unavailable_quantities": [ch for ch in CHANNEL_UNITS if ch not in {ch2 for o in obs_rows for ch2 in o["measured_channels"]}],
    })


@router.post("/components", status_code=201)
def create_component(body: ComponentIn):
    db = _db()
    doc = body.model_dump()
    if doc.get("id") and db.get("components", doc["id"]):
        raise HTTPException(409, f"Component {doc['id']} already exists")
    if doc.get("aircraft_id") and not db.get("aircraft", doc["aircraft_id"]):
        raise HTTPException(422, f"Unknown aircraft {doc['aircraft_id']}")
    if doc.get("model_type"):
        if doc["model_type"] not in MODEL_REGISTRY:
            raise HTTPException(422, f"Unknown model_type; implemented: {list(MODEL_REGISTRY)}")
        model = MODEL_REGISTRY[doc["model_type"]]
        defaults = {k: p.to_dict() for k, p in model.default_parameters().items()}
        for k, v in (doc.get("parameters") or {}).items():
            if k in defaults:
                defaults[k].update(v)
        doc["parameters"] = defaults
        st = model.default_state(); st.update(doc.get("state") or {})
        doc["state"] = st
        errs = model.validate_parameters({k: float(v["value"]) for k, v in doc["parameters"].items()})
        if errs:
            raise HTTPException(422, "; ".join(errs))
    else:
        doc["parameters"] = {}; doc["state"] = {}
    doc["component_type"] = doc.get("model_type")
    doc["baseline_state"] = dict(doc["state"])
    doc["baseline_provenance"] = doc.get("baseline_provenance") or {k: "manual input" for k in doc["state"]}
    doc["baseline_date"] = doc.get("installation_date")
    doc["response_params"] = {**DEFAULT_RESPONSE_PARAMS, **(doc.get("response_params") or {})}
    doc["model_version"] = 1
    doc["history_initialised"] = False
    if not doc.get("id"):
        doc.pop("id")
    rec = db.insert("components", doc, "CMP")
    db.log_activity("component", f"Component instance {rec['id']} created ({rec['provenance']}).", {"component_id": rec["id"]})
    return get_component(rec["id"])


@router.put("/components/{component_id}")
def update_component(component_id: str, body: ComponentIn):
    db = _db()
    c = db.get("components", component_id)
    if c is None:
        raise HTTPException(404, "Component not found")
    upd = body.model_dump(exclude_unset=True)
    upd.pop("id", None)
    if upd.get("parameters"):
        for k, v in upd["parameters"].items():
            if k in c["parameters"]:
                c["parameters"][k].update(v)
    upd.pop("parameters", None)
    if upd.get("state"):
        c["state"].update(upd.pop("state"))
    upd.pop("state", None)
    if upd.get("response_params"):
        c["response_params"].update(upd.pop("response_params"))
    upd.pop("response_params", None)
    c.update({k: v for k, v in upd.items() if v is not None})
    if c.get("model_type"):
        errs = MODEL_REGISTRY[c["model_type"]].validate_parameters({k: float(v["value"]) for k, v in c["parameters"].items()})
        if errs:
            raise HTTPException(422, "; ".join(errs))
    db.upsert("components", c)
    db.log_activity("component", f"Component {component_id} edited (manual input).", {"component_id": component_id})
    return get_component(component_id)


# ----------------------------------------------------------------- twin lifecycle
@router.get("/twin/{component_id}")
def twin_status(component_id: str):
    return _wrap(twin.twin_status, _db(), component_id)


@router.post("/twin/{component_id}/initialise")
async def initialise_twin(component_id: str):
    return await asyncio.to_thread(_wrap, twin.replay_history, _db(), component_id)


@router.post("/twin/initialise-all")
async def initialise_all():
    return await asyncio.to_thread(_wrap, twin.initialise_all, _db())


@router.get("/twin/{component_id}/next-flight")
def next_flight(component_id: str):
    db = _db()
    f = _wrap(twin.next_scheduled_flight, db, component_id)
    if f is None:
        return {"flight": None, "resolution": None}
    comp = db.get("components", component_id)
    return {"flight": f, "resolution": _wrap(twin.resolve_conditions, db, comp, f)}


@router.get("/twin/{component_id}/playback/{flight_id}")
def twin_playback(component_id: str, flight_id: str):
    """Live-twin playback bundle: phases, forecast channels ±σ, observed channels, intra-flight damage trajectory, reconciliation."""
    return _wrap(playback.flight_playback, _db(), component_id, flight_id)


@router.get("/live")
def live():
    """Lightweight polling snapshot for the reactive UI."""
    return _wrap(playback.live_snapshot, _db())


@router.get("/twin/{component_id}/resolve/{flight_id}")
def resolve(component_id: str, flight_id: str):
    db = _db()
    comp = db.get("components", component_id)
    f = db.get("flights", flight_id)
    if comp is None or f is None:
        raise HTTPException(404, "Component or flight not found")
    return _wrap(twin.resolve_conditions, db, comp, f)


# ----------------------------------------------------------------- flights
@router.get("/flights")
def list_flights(aircraft_id: str | None = None, status: str | None = None):
    db = _db()
    fl = db.list("flights", {"aircraft_id": aircraft_id} if aircraft_id else None)
    if status:
        fl = [f for f in fl if f["status"] == status]
    preds = db.list_fields("predictions", ["id", "component_id", "flight_id", "status"])
    obs = db.list_fields("flight_records", ["id", "component_id", "flight_id"])
    for f in sorted(fl, key=lambda x: x["sequence"]):
        f["predictions"] = [p for p in preds if p["flight_id"] == f["id"]]
        f["observations"] = [o for o in obs if o["flight_id"] == f["id"]]
    return sorted(fl, key=lambda x: x["sequence"])


@router.get("/flights/{flight_id}")
def get_flight(flight_id: str):
    db = _db()
    f = db.get("flights", flight_id)
    if f is None:
        raise HTTPException(404, "Flight not found")
    f["predictions"] = [{k: p.get(k) for k in ("id", "component_id", "model_version", "status", "committed")} for p in db.list("predictions", {"flight_id": flight_id})]
    f["observations"] = [{k: o.get(k) for k in ("id", "component_id", "label", "provenance", "anomaly", "measured_channels")} for o in db.list("flight_records", {"flight_id": flight_id})]
    f["reconciliations"] = [{k: r.get(k) for k in ("id", "component_id", "gate", "summary", "applied")} for r in db.list("reconciliations", {"flight_id": flight_id})]
    return f


@router.post("/flights", status_code=201)
def create_scheduled_flight(body: ScheduledFlightIn):
    db = _db()
    if db.get("aircraft", body.aircraft_id) is None:
        raise HTTPException(404, "Aircraft not found")
    seq = max([f["sequence"] for f in db.list("flights", {"aircraft_id": body.aircraft_id})] + [0]) + 1
    f = {
        "id": f"{body.aircraft_id.replace('AIRCRAFT-', 'AC')}-F{seq:04d}", "aircraft_id": body.aircraft_id, "sequence": seq, "flight_date": body.flight_date, "event_time": f"{body.flight_date}T10:00:00+00:00",
        "route_or_mission": body.route_or_mission, "status": "scheduled", "actual": None, "provenance": "manual",
        "scheduled": {"route": body.route_or_mission, "duration_min": body.duration_min, "landing_cycles": body.landing_cycles, "payload_fraction": body.payload_fraction, "expected_temperature_c": body.expected_temperature_c, "expected_environment": body.expected_environment, "source": "manual entry", "notes": body.notes},
    }
    f = db.insert("flights", f, "flt")
    db.log_activity("flight", f"Scheduled flight {f['id']} entered manually ({body.route_or_mission}, {body.flight_date}).", {"flight_id": f["id"]})
    return f


@router.post("/flights/complete")
def complete_flight(body: CompleteFlightRequest):
    """Demonstration: the reference aircraft flies the scheduled flight and synthetic observations are generated."""
    return _wrap(history.complete_flight_synthetic, _db(), body.flight_id, body.anomaly)


# ----------------------------------------------------------------- predictions
@router.post("/predictions", status_code=201)
async def create_prediction(body: PredictRequest):
    db = _db()
    settings = db.get("settings", "app") or {}
    mc = body.mc_samples if body.mc_samples is not None else int(settings.get("mc_samples", 300))
    seed_v = body.seed if body.seed is not None else int(settings.get("demo_seed", 42))
    return await asyncio.to_thread(_wrap, twin.predict_flight, db, body.component_id, body.flight_id, mc, seed_v)


@router.get("/predictions")
def list_predictions(component_id: str | None = None, flight_id: str | None = None):
    db = _db()
    where = {k: v for k, v in (("component_id", component_id), ("flight_id", flight_id)) if v}
    return [{k: p.get(k) for k in ("id", "component_id", "aircraft_id", "flight_id", "flight_sequence", "flight_event_time", "prediction_timestamp", "model_version", "input_data_version", "status", "committed", "threshold_crossing_fraction", "conditions", "condition_provenance", "assumptions")} | {"predicted_state_after": p["predicted"]["state_after"], "remaining_life": p["predicted"]["remaining_life"]} for p in db.list("predictions", where or None, newest_first=True)]


@router.get("/predictions/{prediction_id}")
def get_prediction(prediction_id: str):
    p = _db().get("predictions", prediction_id)
    if p is None:
        raise HTTPException(404, "Prediction not found")
    return p


@router.post("/predictions/{prediction_id}/commit")
def commit_prediction(prediction_id: str):
    return _wrap(twin.commit_prediction, _db(), prediction_id)


# ----------------------------------------------------------------- observations / reconciliation
@router.post("/observations/manual", status_code=201)
def manual_observation(body: ManualObservationRequest):
    return _wrap(reconciliation.manual_observation, _db(), body.component_id, body.flight_id, body.channel_means, body.note)


@router.get("/observations")
def list_observations(component_id: str | None = None, flight_id: str | None = None, limit: int = Query(100, le=1000)):
    db = _db()
    where = {k: v for k, v in (("component_id", component_id), ("flight_id", flight_id)) if v}
    recs = db.list("flight_records", where or None, newest_first=True, limit=limit)
    return [{k: r.get(k) for k in ("id", "component_id", "aircraft_id", "flight_id", "flight_sequence", "event_time", "label", "provenance", "source", "anomaly", "quality_notes", "measured_channels", "created_at")} for r in recs]


@router.get("/observations/{obs_id}")
def get_observation(obs_id: str):
    r = _db().get("flight_records", obs_id)
    if r is None:
        raise HTTPException(404, "Observation not found")
    return _strip_truth(r)


@router.post("/reconciliations", status_code=201)
def create_reconciliation(body: ReconcileRequest):
    return _wrap(reconciliation.reconcile_prediction, _db(), body.prediction_id, body.flight_record_id)


@router.get("/reconciliations")
def list_reconciliations(component_id: str | None = None, limit: int = Query(100, le=1000)):
    recs = _db().list("reconciliations", {"component_id": component_id} if component_id else None, newest_first=True, limit=limit)
    return [{k: r.get(k) for k in ("id", "component_id", "flight_id", "prediction_id", "flight_record_id", "model_version", "gate", "summary", "forecast_summary", "proposals", "applied", "final_decision", "observation_label", "observation_anomaly", "observation_provenance", "explanation", "created_at")} for r in recs]


@router.get("/reconciliations/{rec_id}")
def get_reconciliation(rec_id: str):
    r = _db().get("reconciliations", rec_id)
    if r is None:
        raise HTTPException(404, "Reconciliation not found")
    return r


@router.post("/reconciliations/{rec_id}/apply")
def apply_reconciliation(rec_id: str, body: ApplyUpdateRequest):
    return _wrap(reconciliation.apply_operational_update, _db(), rec_id, body.decision_override)


# ----------------------------------------------------------------- inspections / maintenance
@router.get("/inspections")
def list_inspections(component_id: str | None = None):
    return _db().list("inspections", {"component_id": component_id} if component_id else None, newest_first=True)


@router.get("/inspections/methods")
def inspection_methods():
    return {"methods": inspection.INSPECTION_METHODS, "quantity_units": inspection.QUANTITY_UNITS}


@router.post("/inspections", status_code=201)
def create_inspection(body: InspectionIn):
    return _wrap(inspection.add_inspection, _db(), body.model_dump())


@router.post("/inspections/synthetic", status_code=201)
def synthetic_inspection(component_id: str, quantity: str, measurement_sd: float = Query(gt=0), method: str = "ultrasonic", seed: int = 11):
    """Draw a synthetic inspection measurement from the hidden reference model (demonstration aid)."""
    db = _db()
    val = _wrap(ground_truth.true_measurement, db, component_id, quantity, measurement_sd, seed)
    scale = inspection.TO_SI[quantity]
    comp = db.get("components", component_id)
    last_flight = max([f for f in db.list("flights", {"aircraft_id": comp.get("aircraft_id")}) if f["status"] == "completed"], key=lambda f: f["sequence"], default=None)
    date = last_flight["flight_date"] if last_flight else "2026-11-04"
    return _wrap(inspection.add_inspection, db, {
        "component_id": component_id, "inspection_date": date, "event_time": f"{date}T18:00:00+00:00", "method": method, "quantity": quantity, "measured_value": round(val / scale, 4), "unit": inspection.QUANTITY_UNITS[quantity],
        "measurement_uncertainty": round(measurement_sd / scale, 4), "confidence": "high", "observed_defect": "synthetic measurement", "source": "synthetic_demo", "provenance": "synthetic_demo",
        "notes": "SYNTHETIC INSPECTION — drawn from the hidden reference model with the stated measurement uncertainty.",
    })


@router.get("/maintenance")
def list_maintenance(component_id: str | None = None):
    return _db().list("maintenance", {"component_id": component_id} if component_id else None, newest_first=True)


@router.post("/maintenance", status_code=201)
def create_maintenance(body: MaintenanceIn):
    db = _db()
    comp = db.get("components", body.component_id)
    if comp is None:
        raise HTTPException(404, "Component not found")
    doc = body.model_dump()
    apply = doc.pop("apply")
    doc.update({"aircraft_id": comp.get("aircraft_id"), "event_time": f"{body.maintenance_date}T15:00:00+00:00", "provenance": "manual", "applied_in_history": False})
    rec = db.insert("maintenance", doc, "mnt")
    db.log_activity("maintenance", f"Maintenance record {rec['id']} added for {body.component_id}.", {"maintenance_id": rec["id"]})
    if apply and comp.get("model_type"):
        return _wrap(twin.apply_maintenance, db, rec["id"])
    return {"maintenance": rec, "update": None, "component": comp}


# ----------------------------------------------------------------- history / validation
@router.get("/model-history")
def model_history_endpoint(component_id: str | None = None):
    db = _db()
    return sanitize({
        "timeline": model_history.timeline(db, component_id),
        "updates": db.list("model_updates", {"component_id": component_id} if component_id else None, newest_first=True),
        "reconciliations": [{k: r.get(k) for k in ("id", "component_id", "flight_id", "model_version", "gate", "summary", "created_at", "seq")} for r in db.list("reconciliations", {"component_id": component_id} if component_id else None)],
    })


@router.get("/validation")
async def validation_report(force: bool = False, component_id: str = "ENG-MOUNT-001"):
    db = _db()
    tests = await asyncio.to_thread(validation.run_test_suite, force)
    exp = None
    if db.get("components", component_id) and (db.get("components", component_id) or {}).get("model_type"):
        exp = await asyncio.to_thread(_wrap, validation.chronological_experiment, db, component_id)
    return sanitize({"tests": tests, "experiment": exp, "demo_comparisons": validation.demo_comparison(db), "reference_models": [ground_truth.revealed_reference(db, g["component_id"]) for g in db.list("ground_truth") if db.get("components", g["component_id"])]})


@router.get("/validation/experiment/{component_id}")
async def validation_experiment(component_id: str):
    return await asyncio.to_thread(_wrap, validation.chronological_experiment, _db(), component_id)

@router.get("/validation/external/phm2019")
def phm2019_external_validation():
    """Evaluate locally supplied PHM 2019 training labels without mixing them into aircraft records."""
    return sanitize(phm2019.build_report())


# ----------------------------------------------------------------- what-if (secondary)
@router.get("/scenarios")
def list_scenarios(component_id: str | None = None):
    return _db().list("scenarios", {"component_id": component_id} if component_id else None, newest_first=True)


@router.post("/scenarios", status_code=201)
def create_scenario(body: ScenarioIn):
    db = _db()
    if db.get("components", body.component_id) is None:
        raise HTTPException(404, "Component not found")
    return db.insert("scenarios", {"component_id": body.component_id, "name": body.name, "notes": body.notes, "missions": [m.clean() for m in body.missions], "provenance": "manual", "label": "ENGINEERING WHAT-IF SCENARIO — NOT AN ACTUAL SCHEDULED FLIGHT"}, "scn")


@router.delete("/scenarios/{scenario_id}")
def delete_scenario(scenario_id: str):
    if not _db().delete("scenarios", scenario_id):
        raise HTTPException(404, "Scenario not found")
    return {"deleted": scenario_id}


@router.post("/simulations")
async def create_simulation(body: SimulationRequest):
    return await asyncio.to_thread(_wrap, simulation.run_simulation, _db(), body.component_id, [m.clean() for m in body.missions], body.label, body.scenario_id, body.mc_samples, body.seed)


@router.get("/simulations")
def list_simulations(component_id: str | None = None, limit: int = Query(20, le=200)):
    runs = _db().list("simulation_runs", {"component_id": component_id} if component_id else None, newest_first=True, limit=limit)
    return [{k: r.get(k) for k in ("id", "component_id", "component_name", "label", "n_flights", "threshold_status", "model_version", "created_at", "scenario_id", "final_state", "remaining_life", "label_note")} for r in runs]


@router.get("/simulations/{run_id}")
def get_simulation(run_id: str):
    r = _db().get("simulation_runs", run_id)
    if r is None:
        raise HTTPException(404, "Run not found")
    return r


@router.post("/simulations/compare")
async def compare_schedules(body: CompareRequest):
    db = _db()

    def work():
        comp = db.get("components", body.component_id)
        if comp is None:
            raise KeyError("Component not found")
        out = []
        for s in body.schedules:
            run = simulation.run_simulation(db, body.component_id, [m.clean() for m in s.missions], label=s.name, mc_samples=body.mc_samples, persist=False)
            out.append({"name": s.name, "missions": run["missions"], "flights": run["flights"], "final_state": run["final_state"], "remaining_life": run["remaining_life"], "threshold_status": run["threshold_status"], "uncertainty": run.get("uncertainty")})
        return {"component_id": body.component_id, "model_version": comp.get("model_version"), "schedules": out, "label": "ENGINEERING WHAT-IF SCENARIO — NOT AN ACTUAL SCHEDULED FLIGHT"}

    return await asyncio.to_thread(_wrap, work)


# ----------------------------------------------------------------- demo / settings / data
@router.post("/demo/run")
async def run_demo(demo_id: str = "engine_mount", reset: bool = True):
    return await asyncio.to_thread(_wrap, demo.run_demo, _db(), demo_id, reset)


@router.get("/demo")
def list_demos():
    db = _db()
    return {"available": [{"id": k, "title": v["title"], "component_id": v["component_id"]} for k, v in demo.DEMOS.items()], "results": [s for s in db.list("settings") if s.get("id", "").startswith("demo_")]}


@router.post("/demo/reset")
def reset_demo():
    db = _db()
    seed.seed_database(db, reset=True)
    validation._cache.clear()
    return {"reset": True, **seed.seed_database(db)}


@router.get("/settings")
def get_settings():
    return _db().get("settings", "app")


@router.put("/settings")
def put_settings(body: SettingsIn):
    db = _db()
    s = db.get("settings", "app") or seed.default_settings()
    s.update({k: v for k, v in body.model_dump().items() if v is not None})
    return db.upsert("settings", s)


@router.get("/data/templates")
def templates():
    return {k: {"description": v["description"], "columns": v["columns"], "required": v["required"], "units": v["units"]} for k, v in csv_import.TEMPLATES.items()}


@router.get("/data/templates/{dataset}.csv", response_class=PlainTextResponse)
def template_csv(dataset: str):
    try:
        return csv_import.template_csv(dataset)
    except KeyError:
        raise HTTPException(404, "Unknown template")


@router.post("/data/import")
async def import_csv(dataset: str, file: UploadFile = File(...), commit: bool = True):
    content = await file.read()
    if len(content) > 20_000_000:
        raise HTTPException(413, "File larger than 20 MB")
    return _wrap(csv_import.validate_and_import, _db(), dataset, content, file.filename or "upload.csv", commit)


@router.get("/data/imports")
def list_imports():
    return _db().list("imports", newest_first=True)


@router.get("/activity")
def activity(limit: int = Query(50, le=500)):
    return _db().list("activity", newest_first=True, limit=limit)
