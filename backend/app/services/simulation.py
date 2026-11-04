"""
Sequential forward simulation: initial state → flight 1 → state → flight 2 → …

Each mission entry may represent `repeat` identical flights. The predicted
flight channels (load / strain / temperature / pressure / vibration time
series) are stored once per mission entry; per-flight damage records are
stored for every flight.
"""
from __future__ import annotations

import copy
from typing import Any

from ..db import Database
from ..engine.base import EngineError
from ..engine.registry import get_model
from ..engine.response import CHANNEL_UNITS, build_flight_loading
from .components import mission_from_dict, param_values, reference_loading, require_model_component, response_values
from .uncertainty import monte_carlo


def _bins_summary(loading) -> list[dict[str, Any]]:
    return [
        {"label": b.label, "stress_range_mpa": round(b.stress_range, 3), "cycles": round(b.cycles, 3), "mean_stress_mpa": round(b.mean_stress, 3)}
        for b in loading.stress_bins
    ]


def simulate_sequence(component: dict[str, Any], missions: list[dict[str, Any]], params: dict[str, float] | None = None, resp: dict[str, float] | None = None, state: dict[str, float] | None = None, store_channels: bool = True) -> dict[str, Any]:
    """Pure function: propagate a component through the mission sequence. Returns the run body (not persisted)."""
    model = get_model(component["model_type"])
    params = params or param_values(component)
    resp = resp or response_values(component)
    errs = model.validate_parameters(params)
    if errs:
        raise EngineError("Invalid component parameters: " + "; ".join(errs))
    state = copy.deepcopy(state or component["state"])
    initial_state = copy.deepcopy(state)
    flights: list[dict[str, Any]] = []
    mission_entries: list[dict[str, Any]] = []
    flight_index = 0
    stop_reason = None
    for mi, mdict in enumerate(missions):
        mission = mission_from_dict(mdict)
        loading = build_flight_loading(component["model_type"], params, resp, mission)
        entry = {
            "index": mi,
            "mission": {**mdict, "name": mdict.get("name") or mission.name, "profile": mission.profile, "repeat": mission.repeat},
            "stress_bins": _bins_summary(loading),
            "max_stress_mpa": loading.max_stress_mpa,
            "peak_temperature_k": loading.peak_temperature_k,
            "pressure_cycles": loading.pressure_cycles,
            "flights": [],
        }
        if store_channels:
            ch = loading.channels
            entry["predicted_channels"] = {
                "t_s": ch["t_s"], "phase": ch["phase"],
                **{k: ch[k] for k in CHANNEL_UNITS if k in ch},
                "baseline": ch.get("baseline", {}),
                "ambient_c": ch.get("ambient_c"),
                "units": {k: CHANNEL_UNITS[k] for k in CHANNEL_UNITS if k in ch},
            }
        damage_added_in_mission: dict[str, float] = {}
        for _rep in range(mission.repeat):
            flight_index += 1
            r = model.step(state, params, loading)
            state = r.new_state
            for k, v in r.increments.items():
                damage_added_in_mission[k] = damage_added_in_mission.get(k, 0.0) + v
            outputs = {k: v for k, v in r.outputs.items() if k not in ("sn_breakdown", "crack")}
            if r.outputs.get("crack"):
                outputs["max_delta_K"] = r.outputs["crack"]["max_delta_K"]
                outputs["a_critical_m"] = r.outputs["crack"]["a_critical_m"]
            margins = {k: v for k, v in r.outputs.items() if k.startswith("margin_") and v is not None}
            rec = {
                "flight_index": flight_index,
                "mission_index": mi,
                "profile": mission.profile,
                "increments": r.increments,
                "state_after": dict(state),
                "outputs": outputs,
                "remaining_margin": min(margins.values()) if margins else None,
                "threshold_status": r.threshold_status,
                "threshold_detail": r.threshold_detail,
                "warnings": r.warnings,
            }
            flights.append(rec)
            entry["flights"].append(flight_index)
            if r.threshold_status == "threshold_crossed":
                stop_reason = f"Threshold crossed at flight {flight_index}: {r.threshold_detail}"
                break
        entry["damage_added"] = damage_added_in_mission
        entry["sn_breakdown"] = r.outputs.get("sn_breakdown")
        mission_entries.append(entry)
        if stop_reason:
            break
    rl = model.remaining_life(state, params, reference_loading({**component, "parameters": {k: {"value": v} for k, v in params.items()}, "response_params": resp}))
    return {
        "missions": mission_entries,
        "flights": flights,
        "final_state": state,
        "initial_state": initial_state,
        "remaining_life": rl,
        "stop_reason": stop_reason,
        "threshold_status": "threshold_crossed" if stop_reason else "within_threshold",
        "n_flights": flight_index,
        "parameters_used": params,
        "response_params_used": resp,
    }


def run_simulation(db: Database, component_id: str, missions: list[dict[str, Any]], label: str = "", scenario_id: str | None = None, mc_samples: int | None = None, seed: int | None = None, persist: bool = True) -> dict[str, Any]:
    comp = require_model_component(db, component_id)
    if not missions:
        raise EngineError("At least one mission is required.")
    if len(missions) > 10:
        raise EngineError("A sequence may contain at most 10 missions.")
    body = simulate_sequence(comp, missions)
    settings = db.get("settings", "app") or {}
    n_mc = mc_samples if mc_samples is not None else settings.get("mc_samples", 300)
    unc = None
    if n_mc and n_mc > 0:
        unc = monte_carlo(comp, missions, n_samples=int(n_mc), seed=seed if seed is not None else settings.get("demo_seed", 42))
    run = {
        "component_id": component_id,
        "component_name": comp["name"],
        "model_type": comp["model_type"],
        "model_version": comp.get("model_version", 1),
        "label": label or f"{comp['id']} — {len(missions)} mission(s)",
        "scenario_id": scenario_id,
        "provenance": "what_if",
        "label_note": "ENGINEERING WHAT-IF SCENARIO — NOT AN ACTUAL SCHEDULED FLIGHT",
        **body,
        "uncertainty": unc,
    }
    if persist:
        run = db.insert("simulation_runs", run, "run")
        db.log_activity("what_if", f"What-if simulation {run['id']} for {comp['id']} ({run['n_flights']} flights, model v{run['model_version']}); twin state unchanged.", {"run_id": run["id"], "component_id": component_id})
    return run

