"""
Stage B — inspection-evidence damage-state update.

Only reliable damage evidence (an inspection measurement of a damage variable)
may change the component's damage state. The update is an inverse-variance
fusion of the model's current estimate with the measurement:

    x_post = (x_model/σ_m² + x_meas/σ_i²) / (1/σ_m² + 1/σ_i²)

σ_m is the model-state uncertainty, grown with flights since the last accepted
damage-state update; σ_i is the stated inspection measurement uncertainty.

If two accepted crack measurements bracket a known number of simulated flights,
the identifiable Paris coefficient C is re-estimated from the ratio of observed
to predicted growth (damped, bounded) — a simple, transparent parameter
identification rather than a black-box fit.
"""
from __future__ import annotations

import math
from typing import Any

from ..db import Database
from ..engine.base import EngineError
from .components import require_model_component
from .model_history import record_update, snapshot_component

INSPECTION_METHODS = {
    "ultrasonic": {"label": "Ultrasonic crack measurement", "quantities": ["crack_length_m"], "quantitative": True},
    "eddy_current": {"label": "Eddy-current inspection", "quantities": ["crack_length_m", "pit_depth_m"], "quantitative": True},
    "borescope": {"label": "Borescope observation", "quantities": ["oxide_thickness_m", "creep_strain"], "quantitative": False},
    "fpi": {"label": "Fluorescent penetrant inspection", "quantities": ["crack_length_m"], "quantitative": True},
    "radiographic": {"label": "Radiographic inspection", "quantities": ["crack_length_m"], "quantitative": True},
    "visual": {"label": "Visual inspection", "quantities": [], "quantitative": False},
    "wear_measurement": {"label": "Material wear measurement", "quantities": ["wear_indicator"], "quantitative": True},
    "corrosion_measurement": {"label": "Corrosion depth measurement", "quantities": ["pit_depth_m"], "quantitative": True},
    "leakage_test": {"label": "Bench internal-leakage test", "quantities": ["wear_indicator"], "quantitative": True},
    "other": {"label": "Other engineering inspection", "quantities": ["crack_length_m", "pit_depth_m", "wear_indicator", "oxide_thickness_m", "creep_strain"], "quantitative": True},
}

QUANTITY_UNITS = {"crack_length_m": "mm", "pit_depth_m": "µm", "wear_indicator": "-", "oxide_thickness_m": "µm", "creep_strain": "%"}
TO_SI = {"crack_length_m": 1e-3, "pit_depth_m": 1e-6, "wear_indicator": 1.0, "oxide_thickness_m": 1e-6, "creep_strain": 1e-2}
MONOTONIC = {"crack_length_m", "pit_depth_m", "wear_indicator", "oxide_thickness_m", "creep_strain"}
# Identifiable rate coefficient per damage quantity (growth is ~linear in the coefficient over an interval)
COEFFICIENT_FOR = {"crack_length_m": "paris_C", "wear_indicator": "wear_k", "pit_depth_m": "corrosion_rate_m_per_s", "creep_strain": "creep_A"}


def _model_sigma(component: dict[str, Any], quantity: str) -> float:
    """Model-state uncertainty for the quantity, grown with flights since last damage update."""
    x = float(component["state"].get(quantity, 0.0))
    flights_since = float(component.get("flights_since_damage_update", component["state"].get("flights", 0)))
    base = {"crack_length_m": 2.5e-4, "pit_depth_m": 2.0e-5, "wear_indicator": 0.03, "oxide_thickness_m": 2.0e-6, "creep_strain": 5e-4}[quantity]
    growth = {"crack_length_m": 5e-6, "pit_depth_m": 5e-8, "wear_indicator": 2e-4, "oxide_thickness_m": 1e-8, "creep_strain": 2e-6}[quantity]
    return math.sqrt(base ** 2 + (growth * flights_since) ** 2 + (0.03 * x) ** 2)


def add_inspection(db: Database, payload: dict[str, Any]) -> dict[str, Any]:
    """Store an inspection record and, if it carries a usable measurement, propose/apply a Stage-B update."""
    comp = db.get("components", payload["component_id"])
    if comp is None:
        raise KeyError("Component not found")
    method = payload["method"]
    if method not in INSPECTION_METHODS:
        raise EngineError(f"Unknown inspection method '{method}'")
    rec = {
        "component_id": comp["id"],
        "aircraft_id": comp.get("aircraft_id"),
        "inspection_date": payload.get("inspection_date"),
        "event_time": payload.get("event_time") or f"{payload.get('inspection_date')}T14:00:00+00:00",
        "method": method,
        "method_label": INSPECTION_METHODS[method]["label"],
        "observed_defect": payload.get("observed_defect", ""),
        "quantity": payload.get("quantity"),
        "measured_value": payload.get("measured_value"),
        "unit": payload.get("unit"),
        "measurement_uncertainty": payload.get("measurement_uncertainty"),
        "confidence": payload.get("confidence", "medium"),
        "source": payload.get("source", "manual"),
        "provenance": payload.get("provenance", "manual"),
        "notes": payload.get("notes", ""),
        "update": None,
    }
    rec = db.insert("inspections", rec, "insp")
    db.log_activity("inspection", f"Inspection {rec['id']} ({rec['method_label']}) recorded for {comp['id']}.", {"inspection_id": rec["id"], "component_id": comp["id"]})
    if comp.get("model_type") and rec["quantity"] and rec["measured_value"] is not None and payload.get("apply_update", True):
        result = damage_state_update(db, rec["id"])
        rec = db.get("inspections", rec["id"])
        rec["update_result"] = result
    return rec


def damage_state_update(db: Database, inspection_id: str) -> dict[str, Any]:
    insp = db.get("inspections", inspection_id)
    if insp is None:
        raise KeyError("Inspection not found")
    comp = require_model_component(db, insp["component_id"])
    q = insp["quantity"]
    if q not in QUANTITY_UNITS:
        raise EngineError(f"Quantity '{q}' is not a damage-state variable this model can update.")
    if q not in comp["state"]:
        raise EngineError(f"Component state has no variable '{q}'.")
    method = INSPECTION_METHODS[insp["method"]]
    reasons: list[str] = []
    decision = "accept"
    unit_scale = TO_SI[q]
    x_meas = float(insp["measured_value"]) * unit_scale
    unc = insp.get("measurement_uncertainty")
    if unc is None:
        reasons.append("No measurement uncertainty stated — a conservative 25 % of the measured value is assumed; update accepted with reduced confidence.")
        sigma_i = max(0.25 * abs(x_meas), 1e-9)
        decision = "accept_reduced_confidence"
    else:
        sigma_i = float(unc) * unit_scale
    if sigma_i <= 0:
        raise EngineError("Measurement uncertainty must be positive.")
    if q not in method["quantities"]:
        reasons.append(f"{method['label']} is not a recognised quantitative method for {q}; evidence treated as low confidence.")
        decision = "accept_reduced_confidence"
    if not method["quantitative"]:
        reasons.append(f"{method['label']} is qualitative; a numerical update requires a quantitative method.")
        decision = "request_more_evidence"
    if x_meas < 0:
        raise EngineError("Measured damage quantity cannot be negative.")
    x_model = float(comp["state"][q])
    sigma_m = _model_sigma(comp, q)
    sigma_comb = math.sqrt(sigma_m ** 2 + sigma_i ** 2)
    z = (x_meas - x_model) / sigma_comb if sigma_comb > 0 else 0.0
    if sigma_i > 0.5 * max(abs(x_meas), 1e-12):
        reasons.append(f"Measurement uncertainty ({sigma_i/unit_scale:.3g} {QUANTITY_UNITS[q]}) exceeds 50 % of the measured value — more evidence requested.")
        decision = "request_more_evidence"
    new_defect = x_model <= 0 and x_meas > 0 and q in ("crack_length_m",)
    if new_defect:
        reasons.append("New defect detected: the model carried no crack; the state is initialised at the measured value (no fusion with a zero estimate).")
        decision = "accept" if decision == "accept" else decision
    if q in MONOTONIC and x_model > 0 and z < -3.0:
        reasons.append(f"Measured value is {abs(z):.1f}σ BELOW the model estimate; {q} cannot physically decrease. Contradictory evidence — update rejected pending re-inspection.")
        decision = "reject"
    elif abs(z) > 4.0 and not new_defect:
        reasons.append(f"Measured value differs from the model estimate by {abs(z):.1f}σ (combined); accepted with reduced confidence and flagged for engineering review.")
        decision = "accept_reduced_confidence"
    if insp.get("confidence") == "low" and decision == "accept":
        reasons.append("Inspector confidence stated as low — accepted with reduced confidence.")
        decision = "accept_reduced_confidence"

    blend = {"accept": 1.0, "accept_reduced_confidence": 0.5}.get(decision, 0.0)
    before = snapshot_component(comp)
    changes: dict[str, dict[str, Any]] = {}
    applied = blend > 0
    x_post = x_model
    sigma_post = sigma_m
    if applied and new_defect:
        x_post = x_meas
        sigma_post = sigma_i / math.sqrt(blend)
    elif applied:
        w_m = 1.0 / sigma_m ** 2
        w_i = blend / sigma_i ** 2  # reduced confidence ⇒ inflated measurement variance
        x_post = (w_m * x_model + w_i * x_meas) / (w_m + w_i)
        sigma_post = math.sqrt(1.0 / (w_m + w_i))
    if applied:
        comp["state"][q] = x_post
        changes[q] = {"before": x_model, "after": x_post, "measured": x_meas, "sigma_model": sigma_m, "sigma_measurement": sigma_i, "sigma_posterior": sigma_post, "unit": "SI"}
        if new_defect and q == "crack_length_m" and "initial_crack_m" in comp["parameters"]:
            comp["parameters"]["initial_crack_m"]["value"] = x_post
            comp["parameters"]["initial_crack_m"]["provenance"] = "measured"
        # --- identifiable degradation-coefficient re-estimation
        # The rate coefficient of the mechanism is re-estimated only when the predicted growth since the
        # last accepted damage update is large compared with the combined measurement uncertainties
        # (identifiability criterion); otherwise the ratio would be dominated by measurement noise.
        last = comp.get("last_damage_update")
        coeff = COEFFICIENT_FOR.get(q)
        if coeff and last and last.get("quantity") == q and last.get("flights_at_update") is not None and coeff in comp["parameters"]:
            pred_growth = x_model - float(last["value_after"])
            obs_growth = x_post - float(last["value_after"])
            sigma_last = float(last.get("sigma_after", sigma_m))
            identifiable = pred_growth > 3.0 * math.sqrt(sigma_i ** 2 + sigma_last ** 2)
            if identifiable and obs_growth > 0:
                ratio = obs_growth / pred_growth
                damped = min(max(ratio ** 0.5, 0.5), 2.0)  # damping exponent 0.5, bounded ×0.5…×2 per update
                c_old = comp["parameters"][coeff]["value"]
                c_new = c_old * damped
                comp["parameters"][coeff]["value"] = c_new
                comp["parameters"][coeff]["provenance"] = "calibrated"
                changes[coeff] = {"before": c_old, "after": c_new, "growth_ratio_observed_to_predicted": ratio, "damping_exponent": 0.5, "unit": comp["parameters"][coeff].get("unit", "")}
                reasons.append(f"{coeff} re-estimated from observed/predicted growth ratio {ratio:.2f} (damped ×{damped:.2f}).")
            else:
                reasons.append(f"Growth since the last accepted damage update ({pred_growth/unit_scale:.3g} {QUANTITY_UNITS[q]}) is not identifiable against the measurement uncertainties; {coeff} unchanged.")
        comp["last_damage_update"] = {"quantity": q, "value_after": x_post, "sigma_after": sigma_post, "flights_at_update": comp["state"].get("flights", 0), "inspection_id": inspection_id}
        comp["flights_since_damage_update"] = 0
    evidence = {"type": "inspection", "inspection_id": inspection_id, "method": insp["method"], "measured_value_si": x_meas, "sigma_measurement_si": sigma_i, "sigma_model_si": sigma_m, "z_score": z}
    summary = (
        f"Damage state '{q}' updated from {insp['method_label']} ({decision}): {x_model/unit_scale:.4g} → {x_post/unit_scale:.4g} {QUANTITY_UNITS[q]}."
        if applied else f"Damage-state update not applied ({decision}): " + "; ".join(reasons)
    )
    upd = record_update(db, comp, "B_damage_state" if applied else "C_rejected", decision, evidence, changes, applied, summary, metrics={"before": before, "posterior_sigma_si": sigma_post, "reasons": reasons})
    insp["update"] = {"decision": decision, "applied": applied, "update_id": upd["id"], "reasons": reasons, "z_score": z, "posterior_value": x_post / unit_scale, "posterior_sigma": sigma_post / unit_scale, "unit": QUANTITY_UNITS[q]}
    db.upsert("inspections", insp)
    return {"inspection": insp, "update": upd, "component": db.get("components", comp["id"])}
