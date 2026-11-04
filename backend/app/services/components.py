"""Component helpers shared by the services."""
from __future__ import annotations

from typing import Any

from ..db import Database
from ..engine.base import EngineError
from ..engine.registry import DEFAULT_RESPONSE_PARAMS, MODEL_REGISTRY, get_model
from ..engine.response import Mission, build_flight_loading, mission_from_preset


def param_values(component: dict[str, Any]) -> dict[str, float]:
    return {k: float(v["value"]) for k, v in component.get("parameters", {}).items()}


def response_values(component: dict[str, Any]) -> dict[str, float]:
    return {**DEFAULT_RESPONSE_PARAMS, **component.get("response_params", {})}


def require_model_component(db: Database, component_id: str) -> dict[str, Any]:
    comp = db.get("components", component_id)
    if comp is None:
        raise KeyError(f"Component '{component_id}' not found")
    if not comp.get("model_type"):
        raise EngineError(f"Component '{component_id}' has no implemented degradation model (catalogue entry only).")
    return comp


def mission_from_dict(d: dict[str, Any]) -> Mission:
    d = dict(d)
    preset = d.pop("profile", "normal") or "custom"
    for k in ("id", "predicted_channels", "name_override"):
        d.pop(k, None)
    allowed = set(Mission.__dataclass_fields__.keys())
    clean = {k: v for k, v in d.items() if k in allowed and v is not None}
    if preset in ("custom",):
        return Mission(profile="custom", **clean)
    try:
        return mission_from_preset(preset, **clean)
    except EngineError:
        return Mission(profile=preset, **clean)


def reference_loading(component: dict[str, Any]):
    """Reference (normal) mission loading used to express remaining life in flights."""
    return build_flight_loading(component["model_type"], param_values(component), response_values(component), mission_from_preset("normal"))


def component_assessment(component: dict[str, Any]) -> dict[str, Any]:
    """Current estimated condition, remaining-life estimate and governing margin."""
    if not component.get("model_type"):
        return {"status": "not_modelled", "detail": "No implemented prediction model for this component.", "remaining_life": None, "review_required": False}
    model = get_model(component["model_type"])
    params = param_values(component)
    errs = model.validate_parameters(params)
    if errs:
        return {"status": "invalid_parameters", "detail": "; ".join(errs), "remaining_life": None, "review_required": True}
    ref = reference_loading(component)
    rl = model.remaining_life(component["state"], params, ref)
    probe = model.step(component["state"], params, ref)
    margins = {k: v for k, v in probe.outputs.items() if k.startswith("margin_") and v is not None}
    min_margin = min(margins.values()) if margins else None
    rem = rl.get("governing_remaining_flights")
    review = probe.threshold_status == "threshold_crossed" or (min_margin is not None and min_margin < 0.25) or (rem is not None and rem < 100)
    status = "threshold_crossed" if probe.threshold_status == "threshold_crossed" else ("review" if review else "within_threshold")
    return {
        "status": status,
        "detail": probe.threshold_detail,
        "remaining_life": rl,
        "margins": margins,
        "min_margin": min_margin,
        "review_required": review,
        "reference_mission": "normal",
    }
