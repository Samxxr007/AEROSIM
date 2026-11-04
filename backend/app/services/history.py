"""
Synthetic, chronologically consistent demonstration history for the fleet.

Generated from the hidden reference models (ground truth) so that flights,
observations, inspections and maintenance events of each component instance
form ONE coherent sequence. Every record is labelled as synthetic.

Scheduled information (known before a flight) and actual information (known
only after the flight) are stored separately on the flight record so that
pre-flight predictions can never use post-flight data.
"""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

import numpy as np

from ..db import Database
from ..engine.registry import get_model
from ..engine.response import build_flight_loading
from .components import mission_from_dict, param_values
from .seed import AIRCRAFT_ID

SYNTHETIC_LABEL = "SYNTHETIC ACTUAL-FLIGHT OBSERVATION — SIMULATED GROUND TRUTH"

# Route catalogue (demonstration). Payload fraction drives the planned load factor through a documented relation.
ROUTES: dict[str, dict[str, Any]] = {
    "DEMO-A → DEMO-B": {"duration_min": 120, "environment": "benign", "manoeuvre_mu": 1.0, "intensity_mu": 1.00, "temp_mu": 18.0},
    "DEMO-B → DEMO-C": {"duration_min": 95, "environment": "marine", "manoeuvre_mu": 1.4, "intensity_mu": 1.08, "temp_mu": 27.0},
    "DEMO-C → DEMO-A": {"duration_min": 150, "environment": "humid", "manoeuvre_mu": 0.8, "intensity_mu": 0.97, "temp_mu": 24.0},
}
ROUTE_CYCLE = list(ROUTES)

# Completed flights (date) and scheduled flights of the demonstration aircraft
HISTORICAL_FLIGHT_DATES = ["2026-08-03", "2026-08-07", "2026-08-11", "2026-08-18", "2026-08-24", "2026-08-30", "2026-09-05", "2026-09-14", "2026-09-22", "2026-10-01", "2026-10-12", "2026-10-28"]
SCHEDULED_FLIGHT_DATES = ["2026-11-05", "2026-11-08", "2026-11-12"]


def planned_load_factor(payload_fraction: float) -> float:
    """Documented engineering relation between planned payload fraction and representative structural load factor."""
    return round(0.85 + 0.20 * payload_fraction, 4)


def _flight_id(seq: int) -> str:
    return f"AC001-F{seq:04d}"


def scheduled_info(seq: int, rng: np.random.Generator) -> dict[str, Any]:
    route = ROUTE_CYCLE[(seq - 1) % 3]
    r = ROUTES[route]
    payload = round(float(rng.uniform(0.55, 0.95)), 2)
    return {
        "route": route,
        "duration_min": r["duration_min"],
        "landing_cycles": 1,
        "payload_fraction": payload,
        "expected_temperature_c": round(r["temp_mu"] + float(rng.normal(0, 3)), 1),
        "expected_environment": r["environment"],
        "source": "demonstration schedule (synthetic)",
    }


def actual_conditions(sched: dict[str, Any], rng: np.random.Generator) -> dict[str, Any]:
    """What the hidden reference aircraft actually flew (recorded after the flight)."""
    r = ROUTES[sched["route"]]
    return {
        "duration_min": round(sched["duration_min"] * float(rng.normal(1.0, 0.04)), 1),
        "landing_cycles": int(sched["landing_cycles"]),
        "load_factor": round(planned_load_factor(sched["payload_fraction"]) * float(rng.normal(1.0, 0.03)), 4),
        "load_variation": round(float(rng.uniform(0.08, 0.16)), 3),
        "manoeuvre_intensity": round(max(0.2, r["manoeuvre_mu"] + float(rng.normal(0, 0.15))), 3),
        "temperature_c": round(sched["expected_temperature_c"] + float(rng.normal(0, 2.0)), 1),
        "pressure_factor": round(float(rng.normal(1.0, 0.02)), 4),
        "vibration_level": round(max(0.3, float(rng.normal(1.0, 0.08))), 3),
        "environment": sched["expected_environment"],
        "operating_intensity": round(r["intensity_mu"] * float(rng.normal(1.0, 0.04)), 4),
        "source": "flight-data-recorder summary (synthetic)",
    }


def _mission_dict(cond: dict[str, Any]) -> dict[str, Any]:
    keys = ["duration_min", "landing_cycles", "load_factor", "load_variation", "manoeuvre_intensity", "temperature_c", "pressure_factor", "vibration_level", "environment", "operating_intensity"]
    return {"profile": "custom", **{k: cond[k] for k in keys if k in cond}}


def generate_observation(db: Database, comp: dict[str, Any], gt: dict[str, Any], flight: dict[str, Any], anomaly: str = "none") -> dict[str, Any]:
    """Generate the synthetic post-flight observation of one component for one completed flight and advance the hidden truth."""
    params = {**param_values(comp), **gt.get("param_overrides", {})}
    resp = dict(gt["response_params"])
    seq = int(flight["sequence"])
    rng = np.random.default_rng(int(gt["seed"]) * 1000 + seq)
    mission = mission_from_dict(_mission_dict(flight["actual"]))
    loading = build_flight_loading(comp["model_type"], params, resp, mission)
    ch = loading.channels
    n = len(ch["t_s"])
    channels: dict[str, Any] = {}
    quality_notes: list[str] = []
    from ..engine.response import CHANNEL_UNITS

    for name in CHANNEL_UNITS:
        if name not in ch:
            continue
        clean = np.array(ch[name], dtype=float)
        sd = float(gt.get("sensor_noise", {}).get(name, 0.0))
        bias = float(gt.get("sensor_bias", {}).get(name, 0.0))
        obs = clean + bias + rng.normal(0.0, sd, size=n)
        if anomaly == "sensor_bias" and name in ("load_kN", "strain_microstrain", "pressure_bar"):
            obs = obs * 1.6
            quality_notes.append(f"{name}: injected +60 % sensor scale fault")
        if anomaly == "outliers":
            idx = rng.choice(n, size=max(1, n // 5), replace=False)
            obs[idx] = obs[idx] * rng.choice([-3.0, 4.0, 6.0], size=len(idx))
            quality_notes.append(f"{name}: 20 % of samples corrupted with outliers")
        arr: list[float | None] = [float(v) for v in obs]
        if anomaly == "dropout":
            for i in range(int(0.35 * n), int(0.80 * n)):
                arr[i] = None
            quality_notes.append(f"{name}: 45 % of samples missing (data-link dropout)")
        channels[name] = arr
    if anomaly == "wrong_component":
        for name in channels:
            channels[name] = [None if v is None else v * 0.2 for v in channels[name]]
        quality_notes.append("observation appears to belong to a different installation (all channels ≈ 20 % of expected)")

    model = get_model(comp["model_type"])
    r = model.step(gt["state"], params, loading)
    gt["state"] = r.new_state
    gt["flights_generated"] = gt.get("flights_generated", 0) + 1
    db.upsert("ground_truth", gt)
    record = {
        "component_id": comp["id"],
        "aircraft_id": flight["aircraft_id"],
        "flight_id": flight["id"],
        "flight_sequence": seq,
        "event_time": flight["event_time"],
        "label": SYNTHETIC_LABEL,
        "provenance": "synthetic_ground_truth",
        "source": "hidden reference model (synthetic)",
        "seed": int(gt["seed"]),
        "anomaly": anomaly,
        "quality_notes": quality_notes,
        "measured_channels": list(channels.keys()),
        "channels": {"t_s": ch["t_s"], "phase": ch["phase"], **channels, "units": {k: CHANNEL_UNITS[k] for k in channels}, "ambient_c": ch.get("ambient_c")},
        "truth_state_after": r.new_state,  # validation only — never returned by the twin-facing API
    }
    return db.insert("flight_records", record, "obs")


def complete_flight_synthetic(db: Database, flight_id: str, anomaly: str = "none") -> dict[str, Any]:
    """Mark a scheduled flight as flown by the hidden reference aircraft and generate every component's observation."""
    flight = db.get("flights", flight_id)
    if flight is None:
        raise KeyError("Flight not found")
    if flight["status"] == "completed":
        raise ValueError(f"Flight {flight_id} is already completed.")
    rng = np.random.default_rng(7000 + int(flight["sequence"]))
    flight["actual"] = actual_conditions(flight["scheduled"], rng)
    flight["status"] = "completed"
    flight["completion_source"] = "synthetic reference aircraft"
    db.upsert("flights", flight)
    obs_ids = []
    for gt in db.list("ground_truth"):
        comp = db.get("components", gt["component_id"])
        if comp and comp.get("model_type") and comp.get("aircraft_id") == flight["aircraft_id"]:
            obs_ids.append(generate_observation(db, comp, gt, flight, anomaly)["id"])
    db.log_activity("flight", f"Flight {flight_id} completed (synthetic); {len(obs_ids)} component observations recorded.", {"flight_id": flight_id})
    return {"flight": flight, "observation_ids": obs_ids}


def generate_synthetic_history(db: Database) -> dict[str, int]:
    """Create the coherent demonstration history: 12 completed flights, inspections, maintenance, 3 scheduled flights."""
    rng_sched = np.random.default_rng(2026)
    flights: list[dict[str, Any]] = []
    for i, d in enumerate(HISTORICAL_FLIGHT_DATES + SCHEDULED_FLIGHT_DATES, start=1):
        completed = i <= len(HISTORICAL_FLIGHT_DATES)
        sched = scheduled_info(i, rng_sched)
        f = {
            "id": _flight_id(i), "aircraft_id": AIRCRAFT_ID, "sequence": i, "flight_date": d, "event_time": f"{d}T10:00:00+00:00",
            "route_or_mission": sched["route"], "scheduled": sched, "actual": None, "status": "scheduled", "provenance": "synthetic_demo",
        }
        if completed:
            f["actual"] = actual_conditions(sched, np.random.default_rng(7000 + i))
            f["status"] = "completed"
            f["completion_source"] = "synthetic reference aircraft"
        flights.append(db.upsert("flights", f))

    comps = {c["id"]: c for c in db.list("components") if c.get("model_type")}
    gts = {g["component_id"]: g for g in db.list("ground_truth")}

    # inspection / maintenance events, applied chronologically between flights
    def ut(cid: str, date: str, sd_mm: float, seed: int, note: str) -> dict[str, Any]:
        return {"kind": "inspection", "component_id": cid, "date": date, "method": "ultrasonic", "quantity": "crack_length_m", "sd": sd_mm * 1e-3, "seed": seed, "unit": "mm", "scale": 1e-3, "defect": "edge crack at lug bore", "confidence": "high", "notes": note}

    events: list[dict[str, Any]] = [
        {"kind": "inspection", "component_id": "ENG-MOUNT-001", "date": "2026-08-20", "method": "ultrasonic", "quantity": "crack_length_m", "sd": 0.3e-3, "seed": 301, "unit": "mm", "scale": 1e-3, "defect": "edge crack at lug bore (new finding)", "confidence": "high", "notes": "Scheduled UT; crack detected, repair deferred by engineering disposition."},
        {"kind": "inspection", "component_id": "ENG-MOUNT-002", "date": "2026-08-20", "method": "fpi", "quantity": None, "defect": "no indication", "confidence": "high", "notes": "Scheduled FPI, no crack indication."},
        {"kind": "maintenance", "component_id": "ENG-MOUNT-001", "date": "2026-08-21", "activity": "Crack disposition: repair deferred, 60-day UT monitoring interval set", "repair_or_replacement": "none", "damage_before": {"crack_length_m": 0.0058}, "damage_after": None, "reference": "ENG-DISP-2026-0821"},
        {"kind": "inspection", "component_id": "TURB-BLADE-001", "date": "2026-09-10", "method": "borescope", "quantity": "oxide_thickness_m", "value": 15.0, "sd": 8e-6, "unit": "µm", "scale": 1e-6, "defect": "leading-edge discolouration, light oxidation", "confidence": "low", "notes": "Qualitative borescope estimate; not a thickness measurement."},
        {"kind": "inspection", "component_id": "HYD-ACT-001", "date": "2026-09-20", "method": "leakage_test", "quantity": "wear_indicator", "sd": 0.02, "seed": 302, "unit": "-", "scale": 1.0, "defect": "internal leakage above alert level", "confidence": "high", "notes": "Bench leakage test before seal replacement."},
        {"kind": "maintenance", "component_id": "HYD-ACT-001", "date": "2026-09-20", "activity": "Piston seal set replaced (new seals, manufacturer kit)", "repair_or_replacement": "repair", "damage_before": {"wear_indicator": 0.42}, "damage_after": {"wear_indicator": 0.02}, "reference": "WO-2026-1187", "truth_after": {"wear_indicator": 0.02}},
        {"kind": "inspection", "component_id": "LAND-GEAR-001", "date": "2026-09-25", "method": "eddy_current", "quantity": "pit_depth_m", "sd": 10e-6, "seed": 303, "unit": "µm", "scale": 1e-6, "defect": "corrosion pitting at lower fillet", "confidence": "medium", "notes": "Scheduled EC survey."},
        {"kind": "inspection", "component_id": "LAND-GEAR-002", "date": "2026-09-25", "method": "eddy_current", "quantity": "pit_depth_m", "sd": 10e-6, "seed": 304, "unit": "µm", "scale": 1e-6, "defect": "corrosion pitting at lower fillet", "confidence": "medium", "notes": "Scheduled EC survey."},
        ut("ENG-MOUNT-001", "2026-10-15", 0.2, 305, "60-day monitoring UT."),
        {"kind": "inspection", "component_id": "HYD-ACT-001", "date": "2026-10-20", "method": "leakage_test", "quantity": "wear_indicator", "sd": 0.02, "seed": 306, "unit": "-", "scale": 1.0, "defect": "post-replacement check", "confidence": "high", "notes": "Bench leakage test after seal replacement."},
    ]
    for e in events:
        e["event_time"] = f"{e['date']}T14:00:00+00:00"

    timeline = sorted([{"kind": "flight", "event_time": f["event_time"], "flight": f} for f in flights if f["status"] == "completed"] + events, key=lambda x: (x["event_time"], 0 if x["kind"] == "flight" else 1))
    n_obs = n_insp = n_maint = 0
    for ev in timeline:
        if ev["kind"] == "flight":
            for cid, comp in comps.items():
                generate_observation(db, comp, gts[cid], ev["flight"])
                n_obs += 1
        elif ev["kind"] == "inspection":
            gt = gts[ev["component_id"]]
            rec = {
                "component_id": ev["component_id"], "aircraft_id": AIRCRAFT_ID, "inspection_date": ev["date"], "event_time": ev["event_time"], "method": ev["method"],
                "observed_defect": ev["defect"], "quantity": ev.get("quantity"), "measured_value": None, "unit": ev.get("unit"), "measurement_uncertainty": None,
                "confidence": ev["confidence"], "source": "synthetic inspection record", "provenance": "synthetic_demo", "notes": "SYNTHETIC — " + ev["notes"], "update": None, "applied_in_history": False,
            }
            if ev.get("quantity"):
                if "value" in ev:
                    rec["measured_value"] = ev["value"]
                else:
                    r = np.random.default_rng(ev["seed"])
                    true_v = float(gt["state"].get(ev["quantity"], 0.0))
                    rec["measured_value"] = round(max(0.0, true_v + float(r.normal(0.0, ev["sd"]))) / ev["scale"], 4)
                rec["measurement_uncertainty"] = round(ev["sd"] / ev["scale"], 4)
            from .inspection import INSPECTION_METHODS

            rec["method_label"] = INSPECTION_METHODS[ev["method"]]["label"]
            db.insert("inspections", rec, "insp")
            n_insp += 1
        else:  # maintenance
            rec = {
                "component_id": ev["component_id"], "aircraft_id": AIRCRAFT_ID, "maintenance_date": ev["date"], "event_time": ev["event_time"], "activity": ev["activity"],
                "repair_or_replacement": ev["repair_or_replacement"], "damage_before": ev.get("damage_before"), "damage_after": ev.get("damage_after"),
                "maintenance_reference": ev["reference"], "provenance": "synthetic_demo", "applied_in_history": False,
            }
            db.insert("maintenance", rec, "mnt")
            n_maint += 1
            if ev.get("truth_after"):
                gt = gts[ev["component_id"]]
                gt["state"].update(ev["truth_after"])
                db.upsert("ground_truth", gt)
    db.log_activity("history", f"Synthetic history generated: {len(HISTORICAL_FLIGHT_DATES)} completed flights, {n_obs} observations, {n_insp} inspections, {n_maint} maintenance records, {len(SCHEDULED_FLIGHT_DATES)} scheduled flights.")
    return {"flights": len(flights), "observations": n_obs, "inspections": n_insp, "maintenance": n_maint}
