"""
Hidden reference aircraft model — access helpers.

The hidden reference (one per component instance) generates the synthetic
history and the synthetic observations of completed flights (services/history.py).
The digital twin never reads it. This module exposes only:

* true_measurement — draw an inspection measurement from the hidden true state
  with a stated measurement uncertainty (demonstration inspections);
* revealed_reference — the Validation page's view, used to measure error.
"""
from __future__ import annotations

from typing import Any

import numpy as np

from ..db import Database
from ..engine.base import EngineError
from .components import param_values, require_model_component

SYNTHETIC_LABEL = "SYNTHETIC ACTUAL-FLIGHT OBSERVATION — SIMULATED GROUND TRUTH"
ANOMALIES = ["none", "dropout", "outliers", "sensor_bias", "wrong_component"]


def _truth(db: Database, component_id: str) -> dict[str, Any]:
    gts = db.list("ground_truth", {"component_id": component_id})
    if not gts:
        raise EngineError(f"No hidden reference model configured for {component_id}; demonstration data cannot be generated.")
    return gts[0]


def true_parameters(db: Database, component_id: str) -> tuple[dict[str, float], dict[str, float], dict[str, Any]]:
    comp = require_model_component(db, component_id)
    gt = _truth(db, component_id)
    return {**param_values(comp), **gt.get("param_overrides", {})}, dict(gt["response_params"]), gt


def true_measurement(db: Database, component_id: str, quantity: str, measurement_sd: float, seed: int = 7) -> float:
    """Draw an inspection measurement from the hidden true state with Gaussian measurement error."""
    gt = _truth(db, component_id)
    rng = np.random.default_rng(int(seed) + gt.get("flights_generated", 0))
    if quantity not in gt["state"]:
        raise EngineError(f"Hidden model has no state variable '{quantity}'.")
    return max(0.0, float(gt["state"][quantity] + rng.normal(0.0, measurement_sd)))


def revealed_reference(db: Database, component_id: str) -> dict[str, Any]:
    """For the Validation page only."""
    gt = _truth(db, component_id)
    comp = require_model_component(db, component_id)
    return {
        "component_id": component_id,
        "note": "Hidden reference model revealed for validation only; the digital twin never reads these values.",
        "true_response_params": gt["response_params"],
        "twin_response_params": comp.get("response_params"),
        "true_param_overrides": gt.get("param_overrides", {}),
        "twin_params": {k: comp["parameters"][k]["value"] for k in gt.get("param_overrides", {}) if k in comp["parameters"]},
        "true_state": gt["state"],
        "twin_state": comp["state"],
        "sensor_noise": gt.get("sensor_noise"),
        "sensor_bias": gt.get("sensor_bias"),
        "flights_generated": gt.get("flights_generated", 0),
    }
