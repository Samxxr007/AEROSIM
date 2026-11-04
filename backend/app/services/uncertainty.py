"""
Monte Carlo uncertainty propagation for a mission sequence.

For each sample, uncertain quantities are drawn from the distributions declared
by the component model (`uncertain_parameters()`), grouped by class:

    parameter    – material / degradation coefficients (e.g. S-N A, Paris C)
    measurement  – initial damage state (e.g. crack length from inspection)
    operational  – response parameters (e.g. load transfer factor)
    model_form   – structural model simplifications (e.g. geometry factor Y)

Outputs are SAMPLE PERCENTILES (P5 / P50 / P95) of the model output under the
stated input distributions. They are not calibrated confidence intervals: no
calibration test against independent data has been performed in this prototype
and the UI states this explicitly.

Threshold-crossing probability is reported as the fraction of samples that
crossed the model threshold within the sequence — a model-derived quantity.
"""
from __future__ import annotations

import math
from typing import Any

import numpy as np

from ..engine.base import EngineError
from ..engine.registry import get_model
from ..engine.response import build_flight_loading
from .components import mission_from_dict, param_values, response_values

KEY_METRIC = {
    "engine_mount": "crack_length_m",
    "landing_gear": "miner_damage",
    "turbine_blade": "creep_strain",
    "hydraulic_actuator": "wear_indicator",
}
SECONDARY_METRIC = {
    "engine_mount": "miner_damage",
    "landing_gear": "pit_depth_m",
    "turbine_blade": "thermal_fatigue_damage",
    "hydraulic_actuator": None,
}


def _sample(rng: np.random.Generator, nominal: float, spec: dict[str, Any]) -> float:
    dist = spec.get("dist", "normal")
    if dist == "lognormal":
        cov = spec["cov"]
        sigma = math.sqrt(math.log(1 + cov ** 2))
        mu = math.log(nominal) - 0.5 * sigma ** 2
        return float(rng.lognormal(mu, sigma))
    sd = spec["sd_abs"] if "sd_abs" in spec else spec["cov"] * nominal
    v = float(rng.normal(nominal, sd))
    return max(v, 1e-12) if nominal > 0 else v


def monte_carlo(component: dict[str, Any], missions: list[dict[str, Any]], n_samples: int = 300, seed: int = 42) -> dict[str, Any]:
    if n_samples < 10 or n_samples > 5000:
        raise EngineError("Monte Carlo sample count must be between 10 and 5000.")
    if seed is None or int(seed) < 0:
        raise EngineError("A non-negative integer seed is required for reproducible sampling.")
    model = get_model(component["model_type"])
    specs = model.uncertain_parameters()
    base_params = param_values(component)
    base_resp = response_values(component)
    base_state = dict(component["state"])
    mlist = [mission_from_dict(m) for m in missions]
    total_flights = sum(m.repeat for m in mlist)
    # keep runtime bounded: cap samples so that samples × flights ≤ 60 000
    n_eff = int(min(n_samples, max(10, 60000 // max(total_flights, 1))))
    rng = np.random.default_rng(int(seed))
    key = KEY_METRIC[component["model_type"]]
    key2 = SECONDARY_METRIC[component["model_type"]]

    traj = np.zeros((n_eff, total_flights))
    traj2 = np.zeros((n_eff, total_flights)) if key2 else None
    crossed = np.zeros(n_eff, dtype=bool)
    sampled: dict[str, list[float]] = {k: [] for k in specs}

    for s in range(n_eff):
        params = dict(base_params)
        resp = dict(base_resp)
        state = dict(base_state)
        for name, spec in specs.items():
            if spec.get("state"):
                nominal = state.get(name, 0.0)
                if nominal <= 0:
                    sampled[name].append(nominal)
                    continue
                v = max(1e-6, _sample(rng, nominal, spec))
                state[name] = v
            elif spec.get("response"):
                v = _sample(rng, resp.get(name, 1.0), spec)
                resp[name] = v
            else:
                v = _sample(rng, params[name], spec)
                params[name] = v
            sampled[name].append(v)
        fi = 0
        hit = False
        for m in mlist:
            loading = build_flight_loading(component["model_type"], params, resp, m)
            for _ in range(m.repeat):
                if not hit:
                    r = model.step(state, params, loading)
                    state = r.new_state
                    if r.threshold_status == "threshold_crossed":
                        hit = True
                traj[s, fi] = state.get(key, 0.0)
                if traj2 is not None:
                    traj2[s, fi] = state.get(key2, 0.0)
                fi += 1
        crossed[s] = hit

    pct = lambda arr: {"p5": np.percentile(arr, 5, axis=0).tolist(), "p50": np.percentile(arr, 50, axis=0).tolist(), "p95": np.percentile(arr, 95, axis=0).tolist()}
    # sensitivity: Spearman rank correlation between each sampled input and the final key metric
    final = traj[:, -1]
    sens = {}
    for name, vals in sampled.items():
        v = np.array(vals)
        if len(v) == n_eff and np.std(v) > 0 and np.std(final) > 0:
            rv = np.argsort(np.argsort(v)); rf = np.argsort(np.argsort(final))
            sens[name] = float(np.corrcoef(rv, rf)[0, 1])
        else:
            sens[name] = 0.0
    return {
        "method": "Monte Carlo (seeded, numpy default_rng)",
        "seed": int(seed),
        "n_samples_requested": n_samples,
        "n_samples": n_eff,
        "n_flights": total_flights,
        "key_metric": key,
        "secondary_metric": key2,
        "key_percentiles": pct(traj),
        "secondary_percentiles": pct(traj2) if traj2 is not None else None,
        "threshold_crossing_fraction": float(crossed.mean()),
        "sensitivity_spearman": sens,
        "input_distributions": {k: {**v, "nominal": (base_state.get(k) if v.get("state") else base_resp.get(k) if v.get("response") else base_params.get(k))} for k, v in specs.items()},
        "calibration_status": "NOT CALIBRATED — sample percentiles of the model under stated input distributions; no coverage test against independent data has been performed.",
        "uncertainty_classes": {
            "parameter": [k for k, v in specs.items() if v["class"] == "parameter"],
            "measurement": [k for k, v in specs.items() if v["class"] == "measurement"],
            "operational": [k for k, v in specs.items() if v["class"] == "operational"],
            "model_form": [k for k, v in specs.items() if v["class"] == "model_form"],
        },
    }
