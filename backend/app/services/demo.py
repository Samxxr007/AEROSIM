"""
Deterministic demonstration: the historical-data-driven flight-by-flight loop
for one individual component instance.

    1  load the aircraft                  2  load the component profile
    3  load historical sensor records     4  load historical inspection findings
    5  load maintenance history           6  estimate the current condition (chronological replay)
    7  load the next scheduled flight     8  generate + store the pre-flight prediction
    9  complete the flight (synthetic observations)   10 compare prediction vs actual
   11  Stage A operational update         12 import an inspection measurement
   13  Stage B damage-state update        14 next-flight prediction with the updated twin
   15  model evolution summary
"""
from __future__ import annotations

from typing import Any

from ..db import Database
from .components import require_model_component
from .ground_truth import true_measurement
from .history import complete_flight_synthetic
from .inspection import QUANTITY_UNITS, TO_SI, add_inspection
from .reconciliation import apply_operational_update, reconcile_prediction
from .seed import seed_database
from .twin import commit_prediction, initialise_all, next_scheduled_flight, predict_flight, replay_history

DEMOS: dict[str, dict[str, Any]] = {
    "engine_mount": {
        "id": "engine_mount", "title": "Engine Mount Fatigue Assessment — ENG-MOUNT-001", "component_id": "ENG-MOUNT-001",
        "inspection": {"method": "ultrasonic", "quantity": "crack_length_m", "sigma_si": 1.0e-4, "observed_defect": "Edge crack at lug bore (monitoring UT)", "seed": 11},
        "key_metric": "crack_length_m", "key_unit": "mm", "key_scale": 1e3, "load_channel": "load_kN",
    },
    "hydraulic_actuator": {
        "id": "hydraulic_actuator", "title": "Hydraulic Actuator Seal-Wear Assessment — HYD-ACT-001", "component_id": "HYD-ACT-001",
        "inspection": {"method": "leakage_test", "quantity": "wear_indicator", "sigma_si": 0.02, "observed_defect": "Internal leakage (bench test)", "seed": 5},
        "key_metric": "wear_indicator", "key_unit": "-", "key_scale": 1.0, "load_channel": "pressure_bar",
    },
}


def run_demo(db: Database, demo_id: str = "engine_mount", reset: bool = True, mc_samples: int = 300) -> dict[str, Any]:
    if demo_id not in DEMOS:
        raise KeyError(f"Unknown demo '{demo_id}'")
    cfg = DEMOS[demo_id]
    cid = cfg["component_id"]
    scale, key = cfg["key_scale"], cfg["key_metric"]
    if reset:
        seed_database(db, reset=True)
    steps: list[dict[str, Any]] = []
    comp = require_model_component(db, cid)
    aircraft = db.get("aircraft", comp["aircraft_id"])
    settings = db.get("settings", "app") or {}
    seed = int(settings.get("demo_seed", 42))

    obs = db.list("flight_records", {"component_id": cid})
    insp = db.list("inspections", {"component_id": cid})
    mnt = db.list("maintenance", {"component_id": cid})
    completed = [f for f in db.list("flights", {"aircraft_id": comp["aircraft_id"]}) if f["status"] == "completed"]
    steps.append({"step": 1, "title": "Load aircraft", "detail": f"{aircraft['id']} — {aircraft['aircraft_type']} ({aircraft['registration_or_demo_id']}); {len(completed)} completed flights on record.", "data": {"aircraft_id": aircraft["id"]}})
    steps.append({"step": 2, "title": "Load component profile", "detail": f"{comp['id']} — {comp['name']}; P/N {comp['part_number']}, S/N {comp['serial_number']}, installed {comp['installation_date']}; material {comp['material']}. Baseline at {comp['baseline_date']}: {comp['initial_condition']}", "data": {"component_id": cid, "baseline_state": comp["baseline_state"], "baseline_provenance": comp.get("baseline_provenance")}})
    chans = sorted({c for o in obs for c in o.get("measured_channels", [])})
    steps.append({"step": 3, "title": "Load historical sensor records", "detail": f"{len(obs)} flight observation records ({', '.join(chans)}) at 30 s resolution, each labelled '{obs[0]['label']}'." if obs else "No observation records.", "data": {"observations": len(obs), "channels": chans}})
    steps.append({"step": 4, "title": "Load historical inspection findings", "detail": "; ".join(f"{i['inspection_date']} {i['method_label']}: {i['observed_defect']}" + (f" {i['measured_value']} ± {i['measurement_uncertainty']} {i['unit']}" if i.get("measured_value") is not None else "") for i in sorted(insp, key=lambda x: x["inspection_date"])) or "none", "data": {"inspections": [i["id"] for i in insp]}})
    steps.append({"step": 5, "title": "Load maintenance history", "detail": "; ".join(f"{m['maintenance_date']} {m['activity']} ({m['repair_or_replacement']})" for m in mnt) or "No maintenance interventions in the history window.", "data": {"maintenance": [m["id"] for m in mnt]}})

    # 6 — initialise ALL twins from their own histories (each instance separately), report this one
    initialise_all(db)
    comp = db.get("components", cid)
    es = comp["evidence_summary"]
    steps.append({"step": 6, "title": "Estimate current condition from the component's own history", "detail": f"Chronological replay of {es['completed_flights_with_observations']} flights, {es['inspections']} inspections and {es['maintenance_records']} maintenance records → model v{comp['model_version']}; {key} = {comp['state'][key]*scale:.4g} {cfg['key_unit']}; k_L = {comp['response_params']['load_transfer_factor']:.3f}; {es['applied_updates']} updates applied, {es['rejected_updates']} not applied.", "data": {"state": comp["state"], "response_params": comp["response_params"], "evidence_summary": es}})

    # 7 — next scheduled flight
    flight = next_scheduled_flight(db, cid)
    if flight is None:
        raise RuntimeError("No scheduled flight available for the demonstration.")
    steps.append({"step": 7, "title": "Load next scheduled flight", "detail": f"{flight['id']} on {flight['flight_date']}, {flight['route_or_mission']}: planned {flight['scheduled']['duration_min']} min, payload {flight['scheduled']['payload_fraction']:.0%}, forecast {flight['scheduled']['expected_temperature_c']} °C, {flight['scheduled']['expected_environment']}.", "data": {"flight_id": flight["id"], "scheduled": flight["scheduled"]}})

    # 8 — pre-flight prediction
    pred = predict_flight(db, cid, flight["id"], mc_samples=mc_samples, seed=seed)
    est = [k for k, v in pred["condition_provenance"].items() if not v.startswith("scheduled")]
    steps.append({"step": 8, "title": "Generate and store the pre-flight prediction", "detail": f"{pred['id']} (model v{pred['model_version']}, inputs {pred['input_data_version']}): predicted {key} after flight {pred['predicted']['state_after'][key]*scale:.4g} {cfg['key_unit']}, {('max stress %.0f MPa' % pred['predicted']['max_stress_mpa']) if pred['predicted']['max_stress_mpa'] else ('%d pressure cycles' % pred['predicted']['pressure_cycles'])}; estimated conditions: {', '.join(est)}; MC threshold-crossing fraction {pred['threshold_crossing_fraction']:.1%}.", "data": {"prediction_id": pred["id"], "conditions": pred["conditions"], "condition_provenance": pred["condition_provenance"]}})

    # 9 — the flight takes place (synthetic)
    done = complete_flight_synthetic(db, flight["id"])
    steps.append({"step": 9, "title": "Flight completed — actual post-flight observations ingested", "detail": f"{flight['id']} flown: actual duration {done['flight']['actual']['duration_min']} min (planned {flight['scheduled']['duration_min']}), load factor {done['flight']['actual']['load_factor']} (planned {pred['conditions'].get('load_factor')}). Observations: SYNTHETIC ACTUAL-FLIGHT OBSERVATION — SIMULATED GROUND TRUTH.", "data": {"observation_ids": done["observation_ids"], "actual": done["flight"]["actual"]}})

    # 10 — reconciliation
    rec = reconcile_prediction(db, pred["id"])
    steps.append({"step": 10, "title": "Compare the stored prediction with actual observations", "detail": f"Forecast error {rec['summary']['forecast_mean_relative_error']:.1%}; response-model error (as-flown) {rec['summary']['mean_relative_error']:.1%}; gate: {rec['gate']['decision']}. {' '.join(rec['explanation'][:1])}", "data": {"reconciliation_id": rec["id"], "proposals": rec["proposals"], "gate": rec["gate"]}})

    # 11 — Stage A + commit
    upd_a = apply_operational_update(db, rec["id"])
    commit_prediction(db, pred["id"])
    comp = db.get("components", cid)
    steps.append({"step": 11, "title": "Stage A — operational-model correction and history incorporation", "detail": upd_a["update"]["summary"] + f" Twin state advanced as-flown: {key} = {comp['state'][key]*scale:.4g} {cfg['key_unit']} (model v{comp['model_version']}).", "data": {"update_id": upd_a["update"]["id"], "changes": upd_a["update"]["changes"]}})

    # 12/13 — inspection → Stage B
    ins = cfg["inspection"]
    meas_si = true_measurement(db, cid, ins["quantity"], ins["sigma_si"], seed=ins["seed"])
    insp_rec = add_inspection(db, {
        "component_id": cid, "method": ins["method"], "quantity": ins["quantity"], "measured_value": round(meas_si / TO_SI[ins["quantity"]], 4), "unit": QUANTITY_UNITS[ins["quantity"]],
        "measurement_uncertainty": round(ins["sigma_si"] / TO_SI[ins["quantity"]], 4), "confidence": "high", "observed_defect": ins["observed_defect"],
        "inspection_date": flight["flight_date"], "event_time": flight["event_time"].replace("T10:", "T18:"), "source": "synthetic_demo", "provenance": "synthetic_demo",
        "notes": "SYNTHETIC INSPECTION — drawn from the hidden reference model with the stated measurement uncertainty.",
    })
    upd_b = insp_rec.get("update") or {}
    steps.append({"step": 12, "title": "Import inspection measurement", "detail": f"{insp_rec['method_label']} after {flight['id']}: {insp_rec['measured_value']} ± {insp_rec['measurement_uncertainty']} {insp_rec['unit']} (1σ).", "data": {"inspection_id": insp_rec["id"]}})
    steps.append({"step": 13, "title": "Stage B — damage-state correction from supported evidence only", "detail": f"Decision: {upd_b.get('decision')}; posterior {upd_b.get('posterior_value'):.4g} ± {upd_b.get('posterior_sigma'):.2g} {upd_b.get('unit')}. " + " ".join(upd_b.get("reasons", [])), "data": {"update": upd_b}})

    # 14 — next-flight prediction with updated twin
    comp = db.get("components", cid)
    nxt = next_scheduled_flight(db, cid)
    pred2 = predict_flight(db, cid, nxt["id"], mc_samples=mc_samples, seed=seed)
    steps.append({"step": 14, "title": "Next-flight prediction with the updated digital twin", "detail": f"{pred2['id']} for {nxt['id']} ({nxt['route_or_mission']}, model v{pred2['model_version']}): predicted {key} after flight {pred2['predicted']['state_after'][key]*scale:.4g} {cfg['key_unit']}; governing RUL {pred2['predicted']['remaining_life'].get('governing_remaining_flights')} flights of the reference mission.", "data": {"prediction_id": pred2["id"], "flight_id": nxt["id"]}})

    # 15 — evolution summary (+ chronological experiment on the completed flights)
    from .validation import chronological_experiment

    exp = chronological_experiment(db, cid)
    summ = exp["summary"]
    ups = db.list("model_updates", {"component_id": cid})
    steps.append({"step": 15, "title": "Model evolution over the sequence", "detail": f"Model v1 → v{comp['model_version']} across {len(ups)} update decisions ({sum(1 for u in ups if u['applied'])} applied). Chronological experiment on {exp['n_flights']} completed flights — mean |{key}| error vs hidden reference: A static {summ['A']['mean_abs_state_error']*scale:.3g}, B operational {summ['B']['mean_abs_state_error']*scale:.3g}, C two-stage {summ['C']['mean_abs_state_error']*scale:.3g} {cfg['key_unit']}; mean load forecast error A {summ['A']['mean_forecast_rel_error']:.1%} → C {summ['C']['mean_forecast_rel_error']:.1%}.", "data": {"experiment_summary": summ}})

    result = {
        "id": f"demo_{demo_id}", "demo_id": demo_id, "title": cfg["title"], "component_id": cid, "aircraft_id": comp["aircraft_id"], "seed": seed, "steps": steps,
        "ids": {"flight_id": flight["id"], "prediction_id": pred["id"], "reconciliation_id": rec["id"], "inspection_id": insp_rec["id"], "next_prediction_id": pred2["id"], "next_flight_id": nxt["id"]},
        "experiment": exp, "key_metric": key, "key_unit": cfg["key_unit"],
        "label": "DETERMINISTIC DEMONSTRATION — all flight observations and inspections are synthetic (simulated ground truth)",
    }
    db.upsert("settings", result)
    db.log_activity("demo", f"Demo '{cfg['title']}' completed.", {"demo_id": demo_id})
    return result
