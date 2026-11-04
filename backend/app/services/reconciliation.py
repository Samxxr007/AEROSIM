"""
Prediction reconciliation: the stored pre-flight prediction for flight N is
compared with the actual post-flight observation of the same component and
flight ID. Residuals, measurement reliability, the evidence gate (Stage C) and
the controlled Stage-A operational update live here.

Two comparisons are made and kept separate:

* forecast comparison — the immutable pre-flight prediction (made with the
  planned/estimated conditions) vs actual: the operational forecast error,
  which includes schedule deviation (e.g. the flight lasted 7 % longer);
* as-flown comparison — the same model version re-run with the ACTUAL recorded
  flight conditions vs actual: isolates response-model error, and is the only
  basis for the Stage-A parameter estimate.

DESIGN RULE: a sensor discrepancy is NOT evidence of structural damage. This
module may only propose changes to `response_params`. Crack length, Miner
damage, creep strain and wear are changed exclusively by inspection.py.
"""
from __future__ import annotations

from typing import Any

import numpy as np

from ..db import Database
from ..engine.base import EngineError
from ..engine.registry import get_model
from ..engine.response import CHANNEL_TO_RESPONSE_PARAM, CHANNEL_UNITS, build_flight_loading
from .calibration import rls_estimate
from .components import mission_from_dict, param_values, require_model_component
from .model_history import record_update, snapshot_component


# ---------------------------------------------------------------- quality metrics
def _robust_outlier_fraction(resid: np.ndarray) -> float:
    r = resid[~np.isnan(resid)]
    if r.size < 5:
        return 0.0
    med = np.median(r)
    mad = np.median(np.abs(r - med)) * 1.4826
    if mad < 1e-12:
        return 0.0
    return float(np.mean(np.abs(r - med) / mad > 3.5))


def _noise_estimate(y: np.ndarray) -> float:
    v = y[~np.isnan(y)]
    if v.size < 3:
        return float("nan")
    return float(np.std(np.diff(v)) / np.sqrt(2.0))


def _align(pred_t: list[float], obs_t: list[float], obs_y: list[float | None]) -> np.ndarray:
    """Interpolate observations onto the predicted time grid (None → NaN, no extrapolation, gaps kept)."""
    ot = np.array(obs_t, dtype=float)
    oy = np.array([np.nan if v is None else v for v in obs_y], dtype=float)
    mask = ~np.isnan(oy)
    pt = np.array(pred_t, dtype=float)
    if mask.sum() < 2:
        return np.full(len(pt), np.nan)
    out = np.interp(pt, ot[mask], oy[mask], left=np.nan, right=np.nan)
    if len(ot) > 1:
        dt = float(np.median(np.diff(ot)))
        nearest = np.min(np.abs(pt[:, None] - ot[mask][None, :]), axis=1)
        out[nearest > 1.5 * dt] = np.nan
    return out


def _reliability_score(missing: float, outliers: float, snr: float) -> float:
    s = 1.0 - min(1.0, missing * 1.5) - min(1.0, outliers * 4.0)
    if snr == snr and snr < 2.0:
        s -= 0.3
    return float(max(0.0, min(1.0, s)))


# ---------------------------------------------------------------- core comparison
def compare_channels(pred: dict[str, Any], actual: dict[str, Any], resp_now: dict[str, float], lam: float, estimate: bool = True, keep_series: bool = True) -> tuple[dict[str, Any], dict[str, Any]]:
    """Channel-by-channel comparison of predicted vs observed series; returns (channels, parameter proposals)."""
    channels_out: dict[str, Any] = {}
    param_estimates: dict[str, list[dict[str, float]]] = {}
    for name in CHANNEL_UNITS:
        if name not in pred or name not in actual:
            continue
        p = np.array(pred[name], dtype=float)
        a = _align(pred["t_s"], actual["t_s"], actual[name])
        resid = a - p
        valid = ~np.isnan(resid)
        n = len(p)
        missing_fraction = float(1 - valid.mean())
        if valid.sum() == 0:
            channels_out[name] = {"unit": CHANNEL_UNITS[name], "n": n, "n_valid": 0, "missing_fraction": 1.0, "usable": False, "note": "no overlapping observations"}
            continue
        r = resid[valid]; pv = p[valid]
        scale = float(np.mean(np.abs(pv))) if np.mean(np.abs(pv)) > 1e-9 else 1.0
        outlier_fraction = _robust_outlier_fraction(resid)
        noise = _noise_estimate(a)
        snr = float(np.std(pv) / noise) if noise and noise > 0 else float("nan")
        reliability = _reliability_score(missing_fraction, outlier_fraction, snr)
        ch: dict[str, Any] = {
            "unit": CHANNEL_UNITS[name], "n": n, "n_valid": int(valid.sum()), "missing_fraction": missing_fraction,
            "rmse": float(np.sqrt(np.mean(r ** 2))), "mae": float(np.mean(np.abs(r))), "mean_bias": float(np.mean(r)),
            "relative_error": float(np.mean(np.abs(r)) / scale), "max_abs_residual": float(np.max(np.abs(r))),
            "outlier_fraction": outlier_fraction, "noise_sd_estimate": noise, "snr": snr, "reliability": reliability,
            "usable": bool(reliability >= 0.4 and valid.sum() >= 10),
        }
        if estimate:
            base = np.array(pred["baseline"].get(name, pred[name]), dtype=float)
            pname = CHANNEL_TO_RESPONSE_PARAM[name]
            theta_twin = float(resp_now.get(pname, 1.0))
            y = a - float(pred.get("ambient_c", 0.0)) if name == "temperature_c" else a
            est = rls_estimate(base, y, theta_twin, P0=1.0, lam=lam)
            ch.update({"response_param": pname, "theta_twin": theta_twin, "theta_estimate": est["theta"], "theta_standard_error": est["standard_error"], "relative_change": (est["theta"] - theta_twin) / theta_twin if theta_twin else None})
            if ch["usable"]:
                param_estimates.setdefault(pname, []).append({"theta": est["theta"], "weight": reliability, "channel": name})
        if keep_series:
            ch.update({"predicted": [float(x) for x in p], "actual": [None if np.isnan(x) else float(x) for x in a], "residual": [None if np.isnan(x) else float(x) for x in resid]})
        channels_out[name] = ch
    proposals: dict[str, dict[str, Any]] = {}
    for pname, ests in param_estimates.items():
        w = np.array([e["weight"] for e in ests]); th = np.array([e["theta"] for e in ests])
        theta_new = float(np.sum(w * th) / np.sum(w)); theta_old = float(resp_now.get(pname, 1.0))
        proposals[pname] = {"before": theta_old, "proposed": theta_new, "relative_change": (theta_new - theta_old) / theta_old, "channels": [e["channel"] for e in ests]}
    return channels_out, proposals


def evidence_gate(channels: dict[str, Any], proposals: dict[str, Any], max_change: float) -> dict[str, Any]:
    """Stage C — decide whether the observation may update the operational model."""
    reasons: list[str] = []
    usable = [c for c in channels.values() if c.get("usable")]
    missing = max((c.get("missing_fraction", 0.0) for c in channels.values()), default=0.0)
    outliers = max((c.get("outlier_fraction", 0.0) for c in channels.values()), default=0.0)
    base = {"max_missing_fraction": missing, "max_outlier_fraction": outliers}
    if not usable:
        return {"decision": "reject", "reasons": ["No channel passed the reliability screen."], "blend": 0.0, **base}
    if outliers > 0.15:
        return {"decision": "reject", "reasons": [f"Outlier fraction {outliers:.0%} exceeds 15 % — observation treated as unreliable."], "blend": 0.0, **base}
    big = {p: v for p, v in proposals.items() if abs(v["relative_change"]) > max_change}
    if big:
        for p, v in big.items():
            reasons.append(f"Proposed change to {p} is {v['relative_change']:+.0%}, beyond the {max_change:.0%} single-update limit; implausible for a response-model correction — flagged for engineering investigation, more evidence requested before applying.")
        return {"decision": "request_more_evidence", "reasons": reasons, "blend": 0.0, **base}
    reduced = False
    if missing > 0.10:
        reasons.append(f"Missing-sample fraction {missing:.0%} > 10 % — update accepted with reduced confidence."); reduced = True
    if outliers > 0.05:
        reasons.append(f"Outlier fraction {outliers:.0%} > 5 % — update accepted with reduced confidence."); reduced = True
    low_snr = [k for k, c in channels.items() if c.get("snr") == c.get("snr") and c.get("snr", 10) < 3.0 and c.get("usable")]
    if low_snr:
        reasons.append(f"Low signal-to-noise on {', '.join(low_snr)} — reduced confidence."); reduced = True
    if len(usable) < len(channels):
        reasons.append("Some channels were excluded from the estimate.")
    if reduced:
        return {"decision": "accept_reduced_confidence", "reasons": reasons, "blend": 0.5, **base}
    reasons.append("Observation complete, outlier-free and consistent across channels.")
    return {"decision": "accept", "reasons": reasons, "blend": 1.0, **base}


# ---------------------------------------------------------------- reconciliation of a stored prediction
def reconcile_prediction(db: Database, prediction_id: str, flight_record_id: str | None = None, settings: dict[str, Any] | None = None) -> dict[str, Any]:
    pred = db.get("predictions", prediction_id)
    if pred is None:
        raise KeyError("Prediction not found")
    comp = require_model_component(db, pred["component_id"])
    flight = db.get("flights", pred["flight_id"])
    if flight is None or flight["status"] != "completed" or not flight.get("actual"):
        raise EngineError(f"Flight {pred['flight_id']} is not completed; nothing to reconcile against.")
    if flight_record_id:
        obs = db.get("flight_records", flight_record_id)
        if obs is None:
            raise KeyError("Observation not found")
    else:
        cands = [o for o in db.list("flight_records", {"component_id": comp["id"], "flight_id": pred["flight_id"]})]
        if not cands:
            raise EngineError(f"No actual observation of {comp['id']} for flight {pred['flight_id']} has been recorded.")
        obs = cands[-1]
    if obs["component_id"] != comp["id"] or obs.get("flight_id") != pred["flight_id"]:
        raise EngineError("Observation does not belong to the same component and flight as the prediction.")
    settings = settings or db.get("settings", "app") or {}
    lam = float(settings.get("rls_forgetting_factor", 0.98))
    max_change = float(settings.get("max_relative_change_per_update", 0.40))
    actual = obs["channels"]
    pc = pred.get("predicted_channels")
    if not pc:
        raise EngineError("Prediction has no stored channels.")

    # 1 — forecast comparison (pre-flight prediction vs actual): operational forecast error incl. schedule deviation
    fc_channels, _ = compare_channels(pc, actual, pred["response_params"], lam, estimate=False, keep_series=False)
    # 2 — as-flown comparison (same model version, actual conditions): response-model error → Stage-A estimate
    params = pred["parameters"]
    resp = pred["response_params"]
    mission = mission_from_dict({"profile": "custom", **{k: v for k, v in flight["actual"].items() if k in ("duration_min", "landing_cycles", "load_factor", "load_variation", "manoeuvre_intensity", "temperature_c", "pressure_factor", "vibration_level", "environment", "operating_intensity")}})
    loading = build_flight_loading(comp["model_type"], params, resp, mission)
    ac = loading.channels
    as_flown_channels = {"t_s": ac["t_s"], "phase": ac["phase"], "baseline": ac["baseline"], "ambient_c": ac.get("ambient_c"), **{k: ac[k] for k in CHANNEL_UNITS if k in ac}}
    channels_out, proposals = compare_channels(as_flown_channels, actual, comp.get("response_params", {}), lam, estimate=True, keep_series=True)
    if not channels_out:
        raise EngineError("No common channels between prediction and observation.")
    gate = evidence_gate(channels_out, proposals, max_change)

    rel = lambda d: float(np.mean([c["relative_error"] for c in d.values() if "relative_error" in c])) if any("relative_error" in c for c in d.values()) else float("nan")
    fc_rel, af_rel = rel(fc_channels), rel(channels_out)
    deviation = {k: {"planned": pred["conditions"].get(k), "actual": flight["actual"].get(k)} for k in pred["conditions"] if k in flight["actual"] and pred["conditions"].get(k) != flight["actual"].get(k)}
    explanation = []
    if fc_rel == fc_rel and af_rel == af_rel:
        sched_share = max(0.0, fc_rel - af_rel)
        explanation.append(f"Of the {fc_rel:.1%} mean forecast error, about {sched_share:.1%} is attributable to deviation between planned and actual flight conditions and {af_rel:.1%} to the response model itself.")
    if deviation:
        explanation.append("Conditions that differed from the plan: " + ", ".join(f"{k} {v['planned']} → {v['actual']}" for k, v in list(deviation.items())[:6]) + ".")
    if gate["decision"] == "request_more_evidence":
        explanation.append("The discrepancy is larger than a plausible response-model correction; it is flagged for engineering investigation rather than corrected automatically.")
    rec = {
        "component_id": comp["id"],
        "aircraft_id": comp.get("aircraft_id"),
        "flight_id": pred["flight_id"],
        "prediction_id": prediction_id,
        "flight_record_id": obs["id"],
        "model_version": comp.get("model_version", 1),
        "prediction_model_version": pred["model_version"],
        "observation_label": obs.get("label"),
        "observation_provenance": obs.get("provenance"),
        "observation_anomaly": obs.get("anomaly", "none"),
        "t_s": as_flown_channels["t_s"],
        "phase": as_flown_channels["phase"],
        "channels": channels_out,
        "forecast": {"channels": fc_channels, "mean_relative_error": fc_rel, "conditions_planned": pred["conditions"], "condition_provenance": pred.get("condition_provenance")},
        "forecast_summary": {"mean_relative_error": fc_rel},
        "actual_conditions": flight["actual"],
        "condition_deviation": deviation,
        "proposals": proposals,
        "gate": gate,
        "explanation": explanation,
        "summary": {"mean_relative_error": af_rel, "forecast_mean_relative_error": fc_rel, "channels_usable": sum(1 for c in channels_out.values() if c.get("usable")), "channels_total": len(channels_out), "worst_channel": max(channels_out, key=lambda k: channels_out[k].get("relative_error", 0.0))},
        "applied": False,
        "applied_update_id": None,
        "note": "Residuals reflect the operational response model only; they are never used to change the damage state.",
    }
    rec = db.insert("reconciliations", rec, "rec")
    pred["status"] = "reconciled"
    pred["reconciliation_id"] = rec["id"]
    db.upsert("predictions", pred)
    db.log_activity("reconciliation", f"Reconciliation {rec['id']} for {comp['id']} flight {pred['flight_id']}: forecast error {fc_rel:.1%}, response error {af_rel:.1%}, gate {gate['decision']}.", {"reconciliation_id": rec["id"], "component_id": comp["id"], "flight_id": pred["flight_id"]})
    return rec


# ---------------------------------------------------------------- Stage A apply
def apply_operational_update(db: Database, reconciliation_id: str, force_decision: str | None = None) -> dict[str, Any]:
    """Apply the Stage-A update proposed by a reconciliation. Only response_params change."""
    rec = db.get("reconciliations", reconciliation_id)
    if rec is None:
        raise KeyError("Reconciliation not found")
    if rec.get("applied_update_id"):
        raise EngineError("This reconciliation has already been decided.")
    comp = require_model_component(db, rec["component_id"])
    settings = db.get("settings", "app") or {}
    if force_decision and force_decision not in ("accept", "accept_reduced_confidence", "reject", "request_more_evidence"):
        raise EngineError("Invalid decision override.")
    decision = force_decision or rec["gate"]["decision"]
    blend = {"accept": 1.0, "accept_reduced_confidence": float(settings.get("reduced_confidence_blend", 0.5))}.get(decision, 0.0)
    before = snapshot_component(comp)
    changes: dict[str, dict[str, Any]] = {}
    applied = blend > 0 and bool(rec["proposals"])
    if applied:
        for pname, prop in rec["proposals"].items():
            old = float(comp["response_params"].get(pname, 1.0))
            new = old + blend * (prop["proposed"] - old)
            comp["response_params"][pname] = new
            changes[pname] = {"before": old, "after": new, "proposed": prop["proposed"], "blend": blend, "unit": "-"}
    evidence = {"type": "flight_observation", "flight_id": rec["flight_id"], "reconciliation_id": reconciliation_id, "flight_record_id": rec["flight_record_id"], "observation_label": rec.get("observation_label"), "gate": rec["gate"], "mean_relative_error": rec["summary"]["mean_relative_error"]}
    if applied:
        summary = f"Operational response parameters updated from flight {rec['flight_id']} observation ({decision}, blend {blend:.0%})."
    else:
        summary = f"Operational update for flight {rec['flight_id']} not applied ({decision}): " + "; ".join(rec["gate"]["reasons"])
        if decision == "request_more_evidence":
            comp["uncertainty_inflation"] = round(float(comp.get("uncertainty_inflation", 1.0)) * 1.1, 4)
            summary += " Prediction uncertainty inflated by 10 % pending engineering investigation."
    upd = record_update(db, comp, "A_operational" if applied else "C_rejected", decision, evidence, changes, applied, summary, metrics={"before": before, "channels_usable": rec["summary"]["channels_usable"]}, flight_id=rec["flight_id"])
    if not applied:
        db.upsert("components", comp)
    rec["applied"] = applied
    rec["applied_update_id"] = upd["id"]
    rec["final_decision"] = decision
    db.upsert("reconciliations", rec)
    return {"reconciliation": rec, "update": upd, "component": db.get("components", comp["id"])}


# ---------------------------------------------------------------- manual observation (testing aid)
def manual_observation(db: Database, component_id: str, flight_id: str, channel_values: dict[str, float], note: str = "") -> dict[str, Any]:
    """Create an actual-flight record for a completed flight from manually entered channel means (testing aid).

    The entered mean is applied as a scale on the as-flown predicted channel shape; provenance = 'manual'.
    """
    comp = require_model_component(db, component_id)
    flight = db.get("flights", flight_id)
    if flight is None:
        raise KeyError("Flight not found")
    if flight["status"] != "completed" or not flight.get("actual"):
        raise EngineError("Manual observations can only be entered for completed flights with recorded actual conditions.")
    mission = mission_from_dict({"profile": "custom", **{k: v for k, v in flight["actual"].items() if k in ("duration_min", "landing_cycles", "load_factor", "load_variation", "manoeuvre_intensity", "temperature_c", "pressure_factor", "vibration_level", "environment", "operating_intensity")}})
    loading = build_flight_loading(comp["model_type"], param_values(comp), comp.get("response_params", {}), mission)
    ch = loading.channels
    channels: dict[str, Any] = {"t_s": ch["t_s"], "phase": ch["phase"], "units": {}, "ambient_c": ch.get("ambient_c")}
    for name, mean_val in channel_values.items():
        if name not in ch:
            raise EngineError(f"Channel '{name}' is not predicted for this component.")
        if not isinstance(mean_val, (int, float)) or mean_val != mean_val:
            raise EngineError(f"Observed mean for '{name}' must be numeric.")
        p = np.array(ch[name], dtype=float)
        pm = float(np.mean(p))
        channels[name] = [float(v * ((mean_val / pm) if abs(pm) > 1e-9 else 1.0)) for v in p]
        channels["units"][name] = CHANNEL_UNITS[name]
    rec = db.insert("flight_records", {
        "component_id": component_id, "aircraft_id": comp.get("aircraft_id"), "flight_id": flight_id, "flight_sequence": flight["sequence"], "event_time": flight["event_time"],
        "label": "MANUALLY ENTERED OBSERVATION — TEST INPUT", "provenance": "manual", "source": "manual entry", "anomaly": "none", "quality_notes": [note] if note else [],
        "measured_channels": list(channel_values.keys()), "channels": channels,
    }, "obs")
    db.log_activity("observation", f"Manual observation {rec['id']} entered for {component_id} on {flight_id}.", {"flight_record_id": rec["id"]})
    return rec
