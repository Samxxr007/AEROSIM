"""
Validation service: runs the backend test-suite and reports the actual results
on the Validation page, together with the static-vs-updated twin comparison
from the last demonstration run. Nothing here is hard-coded; if tests fail,
the failures are shown.
"""
from __future__ import annotations

import copy
import subprocess
import sys
import time
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any

import numpy as np

from ..config import BACKEND_DIR
from ..db import Database

_cache: dict[str, Any] = {}


def run_test_suite(force: bool = False) -> dict[str, Any]:
    if _cache.get("result") and not force and time.time() - _cache.get("ts", 0) < 600:
        return _cache["result"]
    junit = Path(BACKEND_DIR) / ".pytest_junit.xml"
    t0 = time.time()
    proc = subprocess.run(
        [sys.executable, "-m", "pytest", "tests", "-q", "-p", "no:cacheprovider", f"--junitxml={junit}"],
        cwd=str(BACKEND_DIR), capture_output=True, text=True, timeout=600,
    )
    elapsed = time.time() - t0
    cases: list[dict[str, Any]] = []
    totals = {"passed": 0, "failed": 0, "errors": 0, "skipped": 0}
    if junit.exists():
        root = ET.parse(junit).getroot()
        for tc in root.iter("testcase"):
            status = "passed"
            msg = ""
            for child in tc:
                if child.tag in ("failure", "error", "skipped"):
                    status = {"failure": "failed", "error": "errors", "skipped": "skipped"}[child.tag]
                    msg = (child.get("message") or "")[:400]
            totals[status] += 1
            cases.append({"file": (tc.get("classname") or "").replace("tests.", "") + ".py", "name": tc.get("name"), "status": status, "time_s": float(tc.get("time") or 0), "message": msg})
    groups: dict[str, list[dict[str, Any]]] = {}
    for c in cases:
        groups.setdefault(c["file"], []).append(c)
    result = {
        "ran_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "elapsed_s": round(elapsed, 2),
        "return_code": proc.returncode,
        "totals": totals,
        "groups": [{"file": k, "cases": v, "passed": sum(1 for c in v if c["status"] == "passed"), "total": len(v)} for k, v in groups.items()],
        "stdout_tail": proc.stdout[-2000:],
        "stderr_tail": proc.stderr[-1000:],
    }
    _cache["result"] = result
    _cache["ts"] = time.time()
    return result


def demo_comparison(db: Database) -> list[dict[str, Any]]:
    out = []
    for s in db.list("settings"):
        if s.get("id", "").startswith("demo_"):
            out.append({"demo_id": s["demo_id"], "title": s["title"], "component_id": s["component_id"], "key_metric": s["key_metric"], "key_unit": s["key_unit"], "experiment": s.get("experiment"), "seed": s["seed"], "label": s["label"]})
    return out


# ---------------------------------------------------------------- chronological A / B / C experiment
def _clone_for_component(db: Database, component_id: str) -> Database:
    comp = db.get("components", component_id)
    scratch = Database(":memory:")
    scratch.upsert("components", copy.deepcopy(comp))
    for a in db.list("aircraft"):
        scratch.upsert("aircraft", copy.deepcopy(a))
    for f in db.list("flights", {"aircraft_id": comp["aircraft_id"]}):
        scratch.upsert("flights", copy.deepcopy(f))
    for coll in ("flight_records", "inspections", "maintenance", "ground_truth"):
        for d in db.list(coll, {"component_id": component_id}):
            scratch.upsert(coll, copy.deepcopy(d))
    s = db.get("settings", "app")
    if s:
        scratch.upsert("settings", copy.deepcopy(s))
    return scratch


def chronological_experiment(db: Database, component_id: str) -> dict[str, Any]:
    """Replay the component's own completed flights chronologically under three model variants.

    A — static physics model (no updates); B — operationally calibrated (Stage A only);
    C — two-stage updated (Stage A + inspection/maintenance Stage B); C_sparse — Stage A + only the first
    quantitative inspection. Errors are measured against the hidden reference that generated the observations.
    Predictions for flight N use only information available before flight N (enforced by the replay).
    """
    from ..engine.registry import get_model
    from .components import param_values, response_values
    from .twin import replay_history
    from ..engine.response import build_flight_loading, mission_from_preset

    comp = db.get("components", component_id)
    if comp is None or not comp.get("model_type"):
        raise KeyError("Modelled component not found")
    key = {"engine_mount": "crack_length_m", "landing_gear": "miner_damage", "turbine_blade": "creep_strain", "hydraulic_actuator": "wear_indicator"}[comp["model_type"]]
    variants = {"A": (False, False, False), "B": (True, False, False), "C": (True, True, False), "C_sparse": (True, True, True)}
    results: dict[str, Any] = {}
    gt = next(iter(db.list("ground_truth", {"component_id": component_id})), None)
    model = get_model(comp["model_type"])
    truth_rul = None
    if gt:
        true_params = {**param_values(comp), **gt.get("param_overrides", {})}
        ref = build_flight_loading(comp["model_type"], true_params, gt["response_params"], mission_from_preset("normal"))
        truth_rul = model.remaining_life(gt["state"], true_params, ref).get("governing_remaining_flights")
    for name, (sa, sb, sparse) in variants.items():
        scratch = _clone_for_component(db, component_id)
        if sparse:
            quant = sorted([i for i in scratch.list("inspections", {"component_id": component_id}) if i.get("measured_value") is not None], key=lambda i: i.get("event_time") or i["inspection_date"])
            for i in quant[1:]:
                scratch.delete("inspections", i["id"])
        out = replay_history(scratch, component_id, stage_a=sa, stage_b=sb, label=name)
        m = out["metrics"]
        c = out["component"]
        rul = model.remaining_life(c["state"], param_values(c), build_flight_loading(c["model_type"], param_values(c), response_values(c), mission_from_preset("normal"))).get("governing_remaining_flights")
        fe = [x["forecast_rel_error"] for x in m if x["forecast_rel_error"] is not None]
        ae = [x["as_flown_rel_error"] for x in m if x["as_flown_rel_error"] is not None]
        se = [abs(x["state_error"]) for x in m if x["state_error"] is not None]
        half = max(1, len(fe) // 2)
        results[name] = {
            "label": {"A": "Static physics model", "B": "Operationally calibrated (Stage A)", "C": "Two-stage updated (Stage A + B)", "C_sparse": "Two-stage, sparse inspections (first only)"}[name],
            "flights": m,
            "mean_forecast_rel_error": float(np.mean(fe)) if fe else None,
            "mean_as_flown_rel_error": float(np.mean(ae)) if ae else None,
            "mean_abs_state_error": float(np.mean(se)) if se else None,
            "final_abs_state_error": float(se[-1]) if se else None,
            "forecast_error_first_half": float(np.mean(fe[:half])) if fe else None,
            "forecast_error_second_half": float(np.mean(fe[half:])) if len(fe) > half else None,
            "final_model_version": c.get("model_version"),
            "final_response_params": c.get("response_params"),
            "twin_rul_flights": rul,
            "truth_rul_flights": truth_rul,
            "rul_error_flights": (rul - truth_rul) if (rul is not None and truth_rul is not None) else None,
            "gate_decisions": {d: sum(1 for x in m if x["gate"] == d) for d in ("accept", "accept_reduced_confidence", "request_more_evidence", "reject")},
        }
    better_B = results["B"]["mean_forecast_rel_error"] is not None and results["A"]["mean_forecast_rel_error"] is not None and results["B"]["mean_forecast_rel_error"] < results["A"]["mean_forecast_rel_error"]
    better_C = results["C"]["mean_abs_state_error"] is not None and results["A"]["mean_abs_state_error"] is not None and results["C"]["mean_abs_state_error"] < results["A"]["mean_abs_state_error"]
    return {
        "component_id": component_id, "key_metric": key, "n_flights": len(results["A"]["flights"]), "truth_rul_flights": truth_rul,
        "summary": {k: {kk: vv for kk, vv in v.items() if kk != "flights"} for k, v in results.items()},
        "variants": results,
        "conclusions": {
            "operational_calibration_reduced_forecast_error": better_B,
            "two_stage_reduced_state_error": better_C,
            "note": "Measured on synthetic ground truth with deterministic seeds; no claim is made beyond this experiment.",
        },
        "leakage_control": "Each pre-flight prediction uses only the twin state and flights with event_time earlier than the predicted flight; comparable-flight statistics exclude the flight itself and all later flights.",
    }
