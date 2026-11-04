"""
Flight playback bundle for the live twin view.

Everything returned here is *derived* from records that already exist (immutable
prediction, flight record, observation, reconciliation) plus a documented
intra-flight interpolation of the per-flight damage increment. Nothing is stored
and nothing changes the twin: playback is a visualisation of the twin's own
records, never a new estimate.

Intra-flight damage trajectory
------------------------------
The physics models produce one increment per flight. For visualisation the
increment is distributed across the flight with a mechanism weight derived from
the predicted channels (documented in METHODOLOGY §9):

    load-driven (Miner damage, crack growth, pit depth from load, wear) :
        w_i ∝ (load_i / max load)^m          (m = S-N exponent, Paris exponent
                                             or wear exponent α)
    temperature-driven (creep strain, oxide thickness):
        w_i ∝ exp(−Q / R T_i)                (Arrhenius)
    thermal fatigue: one cycle at the largest temperature transient.

The cumulative normalised weight gives the fraction of the flight's increment
accumulated at each sample. The end state is exactly the stored state_after.
"""
from __future__ import annotations

from typing import Any

import numpy as np

from ..db import Database
from ..engine.base import EngineError
from ..engine.registry import get_model
from ..engine.response import CHANNEL_UNITS, PHASES, build_flight_loading
from .components import mission_from_dict, param_values, require_model_component, response_values
from .twin import CONDITION_FIELDS, resolve_conditions

R_GAS = 8.314

STATE_LABELS = {
    "miner_damage": ("Miner fatigue damage", "–", 1.0),
    "crack_length_m": ("Crack length", "mm", None),
    "pit_depth_m": ("Corrosion pit depth", "µm", None),
    "creep_strain": ("Creep strain", "%", None),
    "thermal_fatigue_damage": ("Thermal-fatigue damage", "–", 1.0),
    "oxide_thickness_m": ("Oxide thickness", "µm", None),
    "wear_indicator": ("Seal wear indicator", "–", None),
}
DISPLAY_SCALE = {"crack_length_m": 1e3, "pit_depth_m": 1e6, "creep_strain": 100.0, "oxide_thickness_m": 1e6}


def _limits(model_type: str, params: dict[str, float], pred_outputs: dict[str, Any] | None) -> dict[str, float | None]:
    lim: dict[str, float | None] = {"miner_damage": 1.0, "thermal_fatigue_damage": 1.0}
    if model_type in ("engine_mount", "landing_gear"):
        a_c = (pred_outputs or {}).get("a_critical_m")
        lim["crack_length_m"] = a_c
        lim["pit_depth_m"] = params.get("pit_depth_limit_m")
    if model_type == "turbine_blade":
        lim["creep_strain"] = params.get("creep_strain_limit")
        lim["oxide_thickness_m"] = params.get("oxide_limit_m")
    if model_type == "hydraulic_actuator":
        q0, kq, ql = params.get("leak_Q0_lpm", 0.02), params.get("leak_kq_lpm", 0.6), params.get("leak_limit_lpm", 0.5)
        lim["wear_indicator"] = (ql - q0) / kq if kq else None
    return lim


def _weights(model_type: str, params: dict[str, float], ch: dict[str, Any]) -> dict[str, np.ndarray]:
    n = len(ch["t_s"])
    load = np.array(ch.get("load_kN") or [1.0] * n, dtype=float)
    temp_k = np.array(ch.get("temperature_c") or [15.0] * n, dtype=float) + 273.15
    press = np.array(ch.get("pressure_bar") or [1.0] * n, dtype=float)

    def norm(w: np.ndarray) -> np.ndarray:
        w = np.clip(w, 0.0, None)
        s = w.sum()
        return w / s if s > 0 else np.full(n, 1.0 / n)

    def power(x: np.ndarray, m: float) -> np.ndarray:
        mx = float(np.max(x)) if x.size else 0.0
        return norm((x / mx) ** m) if mx > 0 else np.full(n, 1.0 / n)

    w: dict[str, np.ndarray] = {}
    w["miner_damage"] = power(load, params.get("sn_m", 4.0))
    w["crack_length_m"] = power(load, params.get("paris_m", 3.0))
    w["cumulative_cycles"] = np.full(n, 1.0 / n)
    if model_type == "landing_gear":
        w["pit_depth_m"] = np.full(n, 1.0 / n)  # ground exposure is modelled per landing, shown uniformly
    if model_type == "turbine_blade":
        Q = params.get("creep_Q", 300e3)
        w["creep_strain"] = norm(np.exp(-Q / (R_GAS * temp_k)) * (load / max(float(load.max()), 1e-9)) ** params.get("creep_n", 5.0))
        w["oxide_thickness_m"] = norm(np.exp(-params.get("oxidation_Q", 250e3) / (R_GAS * temp_k)))
        tf = np.zeros(n)
        tf[int(np.argmax(np.abs(np.gradient(temp_k)))) if n > 1 else 0] = 1.0
        w["thermal_fatigue_damage"] = tf
    if model_type == "hydraulic_actuator":
        w["wear_indicator"] = norm((press / max(float(press.max()), 1e-9)) ** params.get("wear_alpha", 1.8) * np.exp(params.get("wear_beta_per_k", 0.012) * (temp_k - params.get("T_ref_k", 323.15))))
    return w


def _band(ch: dict[str, Any], cond: dict[str, Any], unc: dict[str, Any], resp_sd: dict[str, float]) -> dict[str, dict[str, list[float]]]:
    """±1σ band from the stated input-condition uncertainty and response-parameter uncertainty (not calibrated)."""
    def rel(field: str) -> float:
        sd = unc.get(field)
        v = cond.get(field)
        return float(sd) / float(v) if sd and v else 0.0

    rel_load = np.hypot(np.hypot(rel("load_factor"), rel("operating_intensity")), resp_sd.get("load_transfer_factor", 0.0))
    rel_vib = np.hypot(rel("vibration_level"), resp_sd.get("vibration_response_factor", 0.0))
    rel_p = np.hypot(rel("pressure_factor"), resp_sd.get("pressure_response_factor", 0.0))
    abs_T = float(unc.get("temperature_c") or 0.0)
    out: dict[str, dict[str, list[float]]] = {}
    for name in CHANNEL_UNITS:
        if name not in ch:
            continue
        arr = np.array(ch[name], dtype=float)
        if name == "temperature_c":
            amb = ch.get("ambient_c", 15.0)
            sd = np.hypot(abs_T, (arr - amb) * resp_sd.get("thermal_response_factor", 0.0))
        elif name in ("load_kN", "strain_microstrain"):
            sd = arr * rel_load
        elif name == "vibration_g":
            sd = arr * rel_vib
        else:
            sd = arr * rel_p
        out[name] = {"lo": (arr - sd).tolist(), "hi": (arr + sd).tolist()}
    return out


def _phase_segments(t: list[float], phase: list[str], total_s: float) -> list[dict[str, Any]]:
    segs = []
    for i, (ti, p) in enumerate(zip(t, phase)):
        if not segs or segs[-1]["phase"] != p:
            segs.append({"phase": p, "start_s": ti, "end_s": None})
    for i, s in enumerate(segs):
        s["end_s"] = segs[i + 1]["start_s"] if i + 1 < len(segs) else total_s
    return segs


def flight_playback(db: Database, component_id: str, flight_id: str) -> dict[str, Any]:
    comp = require_model_component(db, component_id)
    flight = db.get("flights", flight_id)
    if flight is None:
        raise KeyError("Flight not found")
    if flight["aircraft_id"] != comp.get("aircraft_id"):
        raise EngineError("Flight belongs to a different aircraft than the component.")
    model_type = comp["model_type"]
    params = param_values(comp)
    preds = db.list("predictions", {"component_id": component_id, "flight_id": flight_id})
    pred = preds[0] if preds else None
    obs_list = db.list("flight_records", {"component_id": component_id, "flight_id": flight_id})
    obs = obs_list[-1] if obs_list else None
    recs = [r for r in db.list("reconciliations", {"component_id": component_id}) if r.get("flight_id") == flight_id]
    rec = recs[-1] if recs else None

    preview = False
    if pred is not None:
        ch = pred["predicted_channels"]
        cond = pred["conditions"]
        unc = pred.get("condition_uncertainty") or {}
        state_before = pred["state_before"]
        increments = pred["predicted"]["increments"]
        state_after = pred["predicted"]["state_after"]
        outputs = pred["predicted"].get("outputs") or {}
        resp = pred.get("response_params") or response_values(comp)
    else:
        # No stored prediction yet: a *preview* from the current twin (clearly flagged, never stored)
        preview = True
        res = resolve_conditions(db, comp, flight)
        cond, unc = res["conditions"], res["uncertainty"]
        mission = mission_from_dict({"profile": "custom", **{k: v for k, v in cond.items() if k in CONDITION_FIELDS}})
        resp = response_values(comp)
        loading = build_flight_loading(model_type, params, resp, mission)
        r = get_model(model_type).step(comp["state"], params, loading)
        ch = {"t_s": loading.channels["t_s"], "phase": loading.channels["phase"], **{k: loading.channels[k] for k in CHANNEL_UNITS if k in loading.channels}, "ambient_c": loading.channels.get("ambient_c"), "units": {k: CHANNEL_UNITS[k] for k in CHANNEL_UNITS if k in loading.channels}}
        state_before, increments, state_after = comp["state"], r.increments, r.new_state
        outputs = {"a_critical_m": r.outputs.get("crack", {}).get("a_critical_m")} if r.outputs.get("crack") else {}

    t = list(ch["t_s"])
    n = len(t)
    duration_s = float(cond.get("duration_min", 120.0)) * 60.0
    weights = _weights(model_type, params, ch)
    trajectory: dict[str, list[float]] = {}
    for var, inc in increments.items():
        w = weights.get(var)
        if w is None or var not in state_before:
            continue
        cum = np.cumsum(w)
        cum = cum / cum[-1] if cum[-1] > 0 else np.linspace(0, 1, n)
        trajectory[var] = (float(state_before[var]) + cum * float(inc)).tolist()
    # response-parameter relative uncertainty from the model's stated distributions (operational class)
    resp_sd = {k: float(v.get("cov", 0.0)) for k, v in get_model(model_type).uncertain_parameters().items() if v.get("response")}

    observed = None
    if obs is not None:
        och = obs.get("channels") or {}
        observed = {
            "observation_id": obs["id"], "label": obs.get("label"), "provenance": obs.get("provenance"), "anomaly": obs.get("anomaly"),
            "quality_notes": obs.get("quality_notes"), "t_s": och.get("t_s"), "phase": och.get("phase"),
            "channels": {k: och.get(k) for k in CHANNEL_UNITS if k in och}, "units": och.get("units"),
        }

    as_flown = None
    if pred is not None and pred.get("as_flown"):
        as_flown = pred["as_flown"]
    elif flight.get("actual") and pred is not None:
        # committed state not stored yet: show the as-flown re-prediction as a dashed trajectory
        try:
            mission = mission_from_dict({"profile": "custom", **{k: v for k, v in flight["actual"].items() if k in CONDITION_FIELDS}})
            loading = build_flight_loading(model_type, params, resp, mission)
            r = get_model(model_type).step(state_before, params, loading)
            as_flown = {"increments": r.increments, "state_after": r.new_state, "threshold_status": r.threshold_status, "provisional": True}
        except EngineError:
            as_flown = None

    limits = _limits(model_type, params, outputs)
    return {
        "component": {k: comp.get(k) for k in ("id", "name", "model_type", "aircraft_id", "position", "part_number", "serial_number", "model_version")},
        "flight": {k: flight.get(k) for k in ("id", "sequence", "status", "flight_date", "route_or_mission", "scheduled", "actual", "event_time")},
        "prediction_id": pred["id"] if pred else None,
        "preview": preview,
        "preview_note": "No stored pre-flight prediction exists for this flight; the forecast shown is a live preview from the current twin and is not recorded." if preview else None,
        "conditions": cond,
        "condition_provenance": (pred or {}).get("condition_provenance"),
        "condition_uncertainty": unc,
        "duration_s": duration_s,
        "phases": _phase_segments(t, ch["phase"], duration_s),
        "t_s": t,
        "phase": ch["phase"],
        "predicted": {k: ch[k] for k in CHANNEL_UNITS if k in ch},
        "band": _band(ch, cond, unc, resp_sd),
        "band_note": "±1σ from stated input-condition and response-parameter uncertainty; not a calibrated interval.",
        "units": {k: CHANNEL_UNITS[k] for k in CHANNEL_UNITS if k in ch},
        "observed": observed,
        "state_before": state_before,
        "increments": increments,
        "state_after": state_after,
        "as_flown": as_flown,
        "trajectory": trajectory,
        "trajectory_note": "Per-flight model increment distributed across the flight with a documented mechanism weight (load^m or Arrhenius); end point equals the stored state_after.",
        "limits": limits,
        "state_labels": {k: {"label": v[0], "unit": v[1], "scale": DISPLAY_SCALE.get(k, 1.0)} for k, v in STATE_LABELS.items() if k in state_before},
        "response_params": resp,
        "reconciliation": {k: rec.get(k) for k in ("id", "gate", "summary", "forecast_summary", "channels", "applied", "final_decision", "proposals", "explanation", "model_version", "condition_deviation")} if rec else None,
        "remaining_life": (pred or {}).get("predicted", {}).get("remaining_life") if pred else None,
        "threshold_status": (pred or {}).get("predicted", {}).get("threshold_status") if pred else None,
        "phase_order": PHASES,
    }


def live_snapshot(db: Database) -> dict[str, Any]:
    """Cheap polling payload: twin states, versions, flight statuses and latest activity."""
    comps = [c for c in db.list("components") if c.get("model_type")]
    flights = db.list("flights")
    acts = db.list("activity", newest_first=True)[:12]
    return {
        "server_time": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),
        "components": [{"id": c["id"], "model_type": c["model_type"], "aircraft_id": c.get("aircraft_id"), "position": c.get("position"), "state": c.get("state"), "model_version": c.get("model_version"), "response_params": response_values(c), "history_initialised": c.get("history_initialised", False)} for c in comps],
        "flights": [{"id": f["id"], "status": f["status"], "sequence": f["sequence"], "flight_date": f.get("flight_date"), "route_or_mission": f.get("route_or_mission")} for f in sorted(flights, key=lambda f: f["sequence"])],
        "counts": {"predictions": db.count("predictions"), "observations": db.count("flight_records"), "reconciliations": db.count("reconciliations"), "inspections": db.count("inspections"), "updates": db.count("model_updates")},
        "activity": acts,
    }
