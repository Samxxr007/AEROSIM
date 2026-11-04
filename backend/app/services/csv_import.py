"""
Structured CSV import with strict validation and downloadable templates.

Supported datasets:
    flight_observations   actual flight channel time series (one row per sample)
    operational_records   per-flight operational summary records
    inspection_findings   inspection records
    material_properties   material parameter sets
    load_history          stress time history for rainflow counting
    predicted_outputs     externally predicted channel series (same schema as flight_observations)

Invalid files are rejected with exact, engineering-readable problems. Nothing
is silently accepted.
"""
from __future__ import annotations

import io
from typing import Any

import pandas as pd

from ..db import Database
from ..engine.base import EngineError
from ..engine.fatigue import rainflow_bins
from ..engine.response import CHANNEL_UNITS
from .inspection import INSPECTION_METHODS, QUANTITY_UNITS, add_inspection

TEMPLATES: dict[str, dict[str, Any]] = {
    "flight_observations": {
        "description": "Actual post-flight observation time series of one component, keyed by the flight ID of a completed flight. One row per sample. Channel columns are optional but at least one is required.",
        "columns": ["component_id", "flight_id", "t_s", "phase", "load_kN", "strain_microstrain", "temperature_c", "pressure_bar", "vibration_g"],
        "required": ["component_id", "flight_id", "t_s"],
        "example": [["ENG-MOUNT-001", "AC001-F0012", 30 * i, "taxi" if i < 6 else "takeoff", round(19.8 + (0 if i < 6 else 110) + 0.3 * (i % 3), 2), round(290 + (0 if i < 6 else 1600) + 4 * (i % 3), 1), round(16.1 + 0.1 * i, 2), "", round(0.6 + (0 if i < 6 else 0.9) + 0.01 * (i % 2), 3)] for i in range(12)],
        "units": {"t_s": "s", **CHANNEL_UNITS},
    },
    "operational_records": {
        "description": "Per-flight operational summary used to document a component's operating history.",
        "columns": ["component_id", "flight_id", "flight_date", "duration_min", "landing_cycles", "load_factor", "max_temperature_c", "environment", "notes"],
        "required": ["component_id", "flight_date", "duration_min"],
        "example": [["ENG-MOUNT-001", "", "2026-10-02", 118, 1, 1.0, 72, "benign", "revenue flight"]],
        "units": {"duration_min": "min", "max_temperature_c": "°C"},
    },
    "flight_schedule": {
        "description": "Upcoming scheduled flights of an aircraft (known before the flight). Missing operating conditions are later estimated from comparable historical flights.",
        "columns": ["aircraft_id", "flight_date", "route_or_mission", "duration_min", "landing_cycles", "payload_fraction", "expected_temperature_c", "expected_environment", "notes"],
        "required": ["aircraft_id", "flight_date", "route_or_mission", "duration_min"],
        "example": [["AIRCRAFT-001", "2026-11-20", "DEMO-A → DEMO-B", 120, 1, 0.8, 19.0, "benign", "scheduled rotation"]],
        "units": {"duration_min": "min", "expected_temperature_c": "°C", "payload_fraction": "0–1"},
    },
    "flight_actuals": {
        "description": "Actual as-flown conditions of a completed flight (known after the flight). Marks the flight as completed.",
        "columns": ["flight_id", "duration_min", "landing_cycles", "load_factor", "load_variation", "manoeuvre_intensity", "temperature_c", "pressure_factor", "vibration_level", "environment", "operating_intensity", "source"],
        "required": ["flight_id", "duration_min"],
        "example": [["AC001-F0013", 122.4, 1, 1.02, 0.12, 1.1, 24.0, 1.0, 1.0, "benign", 1.0, "FDR summary"]],
        "units": {"duration_min": "min", "temperature_c": "°C"},
    },
    "maintenance_records": {
        "description": "Maintenance interventions. repair_or_replacement ∈ {none, repair, replacement}; damage_after_quantity/value set the post-maintenance damage state (SI units: m, –).",
        "columns": ["component_id", "maintenance_date", "activity", "repair_or_replacement", "damage_after_quantity", "damage_after_value", "maintenance_reference", "notes"],
        "required": ["component_id", "maintenance_date", "activity"],
        "example": [["HYD-ACT-001", "2026-11-15", "Piston seal set replaced", "repair", "wear_indicator", 0.02, "WO-2026-1301", ""]],
        "units": {"damage_after_value": "SI (m for lengths, dimensionless for indicators)"},
    },
    "inspection_findings": {
        "description": "Inspection evidence. quantity must be one of: " + ", ".join(QUANTITY_UNITS) + "; measured_value in the unit shown.",
        "columns": ["component_id", "inspection_date", "method", "observed_defect", "quantity", "measured_value", "unit", "measurement_uncertainty", "confidence", "source", "notes"],
        "required": ["component_id", "inspection_date", "method"],
        "example": [["ENG-MOUNT-001", "2026-11-04", "ultrasonic", "edge crack at lug bore", "crack_length_m", 6.3, "mm", 0.1, "high", "NDT report 1234", ""]],
        "units": {"crack_length_m": "mm", "pit_depth_m": "µm", "wear_indicator": "-", "oxide_thickness_m": "µm", "creep_strain": "%"},
    },
    "material_properties": {
        "description": "Material parameter sets (one row per parameter) that can be applied to a component.",
        "columns": ["component_id", "parameter", "value", "unit", "provenance", "source"],
        "required": ["component_id", "parameter", "value"],
        "example": [["ENG-MOUNT-001", "paris_C", 1.2e-11, "m/cycle/(MPa√m)^m", "catalogue", "material datasheet (illustrative)"], ["ENG-MOUNT-001", "K_IC", 70, "MPa√m", "catalogue", "material datasheet (illustrative)"]],
        "units": {},
    },
    "load_history": {
        "description": "Stress time history (MPa) for rainflow cycle counting. One row per sample.",
        "columns": ["component_id", "flight_id", "t_s", "stress_mpa"],
        "required": ["component_id", "t_s", "stress_mpa"],
        "example": [["ENG-MOUNT-001", "", 0, 40], ["ENG-MOUNT-001", "", 1, 180], ["ENG-MOUNT-001", "", 2, 60], ["ENG-MOUNT-001", "", 3, 220], ["ENG-MOUNT-001", "", 4, 30]],
        "units": {"stress_mpa": "MPa", "t_s": "s"},
    },
    "predicted_outputs": {
        "description": "Externally predicted channel time series (same schema as flight_observations) for comparison.",
        "columns": ["component_id", "flight_id", "t_s", "phase", "load_kN", "strain_microstrain", "temperature_c", "pressure_bar", "vibration_g"],
        "required": ["component_id", "flight_id", "t_s"],
        "example": [["ENG-MOUNT-001", "AC001-F0012", 30 * i, "taxi" if i < 6 else "takeoff", 19.5 + (0 if i < 6 else 110), 286 + (0 if i < 6 else 1600), 16.0, "", 0.6 + (0 if i < 6 else 0.9)] for i in range(12)],
        "units": {"t_s": "s", **CHANNEL_UNITS},
    },
}


def template_csv(dataset: str) -> str:
    if dataset not in TEMPLATES:
        raise KeyError(dataset)
    t = TEMPLATES[dataset]
    df = pd.DataFrame(t["example"], columns=t["columns"])
    return df.to_csv(index=False)


def _problems_common(df: pd.DataFrame, dataset: str, db: Database) -> list[str]:
    t = TEMPLATES[dataset]
    problems: list[str] = []
    missing_cols = [c for c in t["required"] if c not in df.columns]
    if missing_cols:
        problems.append(f"Missing required column(s): {', '.join(missing_cols)}. Expected columns: {', '.join(t['columns'])}.")
        return problems
    unknown = [c for c in df.columns if c not in t["columns"]]
    if unknown:
        problems.append(f"Unknown column(s): {', '.join(unknown)}. Allowed columns: {', '.join(t['columns'])}.")
    if len(df) == 0:
        problems.append("The file contains a header but no data rows.")
        return problems
    for c in t["required"]:
        if df[c].isna().any():
            rows = (df.index[df[c].isna()] + 2).tolist()[:10]
            problems.append(f"Required field '{c}' is empty in row(s) {rows}.")
    if "component_id" in df.columns:
        ids = set(df["component_id"].dropna().astype(str))
        known = {c["id"] for c in db.list("components")}
        bad = sorted(ids - known)
        if bad:
            problems.append(f"Unknown component identifier(s): {', '.join(bad)}. Register the component first.")
    return problems


def _numeric_check(df: pd.DataFrame, cols: list[str], problems: list[str]) -> None:
    for c in cols:
        if c in df.columns:
            coerced = pd.to_numeric(df[c], errors="coerce")
            bad = df[c].notna() & coerced.isna()
            if bad.any():
                rows = (df.index[bad] + 2).tolist()[:10]
                problems.append(f"Column '{c}' must be numeric; non-numeric values in row(s) {rows}.")


def validate_and_import(db: Database, dataset: str, content: bytes, filename: str = "upload.csv", commit: bool = True) -> dict[str, Any]:
    if dataset not in TEMPLATES:
        raise EngineError(f"Unknown dataset type '{dataset}'. Supported: {', '.join(TEMPLATES)}")
    try:
        df = pd.read_csv(io.BytesIO(content))
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "dataset": dataset, "problems": [f"File could not be parsed as CSV: {exc}"], "rows": 0}
    df.columns = [str(c).strip() for c in df.columns]
    problems = _problems_common(df, dataset, db)
    result: dict[str, Any] = {"ok": False, "dataset": dataset, "filename": filename, "rows": int(len(df)), "problems": problems, "imported": None}
    if problems:
        return result

    if dataset in ("flight_observations", "predicted_outputs"):
        _numeric_check(df, ["t_s", *CHANNEL_UNITS], problems)
        known_flights = {f["id"]: f for f in db.list("flights")}
        bad_fl = sorted(set(df["flight_id"].dropna().astype(str)) - set(known_flights))
        if bad_fl:
            problems.append(f"Unknown flight identifier(s): {', '.join(bad_fl)}. Register the flight (schedule) first.")
        for (cid, fi), g in df.groupby(["component_id", "flight_id"]):
            f = known_flights.get(str(fi)); comp = db.get("components", str(cid))
            if f and comp and f.get("aircraft_id") != comp.get("aircraft_id"):
                problems.append(f"Flight {fi} belongs to {f.get('aircraft_id')} but component {cid} is installed on {comp.get('aircraft_id')}.")
            if f and dataset == "flight_observations" and f.get("status") != "completed":
                problems.append(f"Flight {fi} is still scheduled; actual observations can only be attached to a completed flight (import flight_actuals first).")
            if f and dataset == "flight_observations" and db.list_fields("flight_records", ["id"], {"component_id": str(cid), "flight_id": str(fi), "provenance": "uploaded"}):
                problems.append(f"An uploaded observation for {cid} on flight {fi} already exists (duplicate).")
        channels = [c for c in CHANNEL_UNITS if c in df.columns and df[c].notna().any()]
        if not channels:
            problems.append("At least one channel column with values is required: " + ", ".join(CHANNEL_UNITS) + ".")
        if not problems:
            for (cid, fi), g in df.groupby(["component_id", "flight_id"]):
                t = pd.to_numeric(g["t_s"])
                if not t.is_monotonic_increasing:
                    problems.append(f"t_s must be increasing within component {cid}, flight {fi}.")
                if t.duplicated().any():
                    problems.append(f"Duplicate t_s samples within component {cid}, flight {fi}.")
                if len(g) < 10:
                    problems.append(f"Flight {fi} of {cid} has only {len(g)} samples; at least 10 are required for reconciliation.")
                for c in channels:
                    v = pd.to_numeric(g[c], errors="coerce")
                    if c == "temperature_c" and ((v < -100) | (v > 2000)).any():
                        problems.append(f"temperature_c out of plausible range (−100…2000 °C) for {cid} flight {fi}; check units (°C expected).")
                    if c == "pressure_bar" and ((v < 0) | (v > 1000)).any():
                        problems.append(f"pressure_bar out of plausible range (0…1000 bar) for {cid} flight {fi}; check units.")
                    if c in ("load_kN", "vibration_g", "strain_microstrain") and (v.abs() > 1e6).any():
                        problems.append(f"{c} contains implausibly large values for {cid} flight {fi}; check units.")
        result["problems"] = problems
        if problems:
            return result
        imported = []
        if commit:
            for (cid, fi), g in df.groupby(["component_id", "flight_id"]):
                chans: dict[str, Any] = {"t_s": pd.to_numeric(g["t_s"]).tolist(), "phase": g["phase"].fillna("").astype(str).tolist() if "phase" in g.columns else [""] * len(g), "units": {}}
                present = []
                for c in channels:
                    v = pd.to_numeric(g[c], errors="coerce")
                    if v.notna().any():
                        chans[c] = [None if pd.isna(x) else float(x) for x in v]
                        chans["units"][c] = CHANNEL_UNITS[c]
                        present.append(c)
                comp = db.get("components", str(cid))
                f = known_flights[str(fi)]
                rec = db.insert("flight_records", {
                    "component_id": str(cid), "aircraft_id": comp.get("aircraft_id"), "flight_id": str(fi), "flight_sequence": f.get("sequence"), "event_time": f.get("event_time"),
                    "label": "UPLOADED FLIGHT OBSERVATION" if dataset == "flight_observations" else "UPLOADED PREDICTED OUTPUT", "provenance": "uploaded", "source": filename, "anomaly": "none",
                    "quality_notes": [f"imported from {filename}"], "measured_channels": present, "channels": chans, "source_file": filename, "kind": dataset,
                }, "obs")
                imported.append(rec["id"])
            db.log_activity("import", f"Imported {len(imported)} {dataset} record(s) from {filename}.", {"ids": imported})
        result.update(ok=True, imported=imported)
        return result

    if dataset == "inspection_findings":
        _numeric_check(df, ["measured_value", "measurement_uncertainty"], problems)
        bad_methods = sorted(set(df["method"].dropna().astype(str)) - set(INSPECTION_METHODS))
        if bad_methods:
            problems.append(f"Unknown inspection method(s): {', '.join(bad_methods)}. Allowed: {', '.join(INSPECTION_METHODS)}.")
        if "quantity" in df.columns:
            bq = sorted(set(df["quantity"].dropna().astype(str)) - set(QUANTITY_UNITS))
            if bq:
                problems.append(f"Unknown quantity name(s): {', '.join(bq)}. Allowed: {', '.join(QUANTITY_UNITS)}.")
            for i, row in df.iterrows():
                q = row.get("quantity")
                if isinstance(q, str) and q in QUANTITY_UNITS:
                    u = str(row.get("unit", "")).strip()
                    if u and u != QUANTITY_UNITS[q]:
                        problems.append(f"Row {i+2}: unit '{u}' for {q} is not the expected '{QUANTITY_UNITS[q]}'. Convert before import.")
                    if pd.isna(row.get("measured_value")):
                        problems.append(f"Row {i+2}: quantity '{q}' given without a measured_value.")
                    elif float(row.get("measured_value")) < 0:
                        problems.append(f"Row {i+2}: measured_value cannot be negative.")
        try:
            pd.to_datetime(df["inspection_date"], errors="raise")
        except Exception:  # noqa: BLE001
            problems.append("inspection_date must be an ISO date (YYYY-MM-DD).")
        dup = df.duplicated(subset=["component_id", "inspection_date", "method", "quantity"] if "quantity" in df.columns else ["component_id", "inspection_date", "method"])
        if dup.any():
            problems.append(f"Duplicate inspection row(s) at {(df.index[dup] + 2).tolist()}.")
        result["problems"] = problems
        if problems:
            return result
        imported = []
        if commit:
            for _, row in df.iterrows():
                payload = {k: (None if pd.isna(v) else v) for k, v in row.to_dict().items()}
                payload["measured_value"] = None if payload.get("measured_value") is None else float(payload["measured_value"])
                payload["measurement_uncertainty"] = None if payload.get("measurement_uncertainty") is None else float(payload["measurement_uncertainty"])
                payload["provenance"] = "uploaded"
                payload["source"] = payload.get("source") or filename
                rec = add_inspection(db, payload)
                imported.append(rec["id"])
        result.update(ok=True, imported=imported)
        return result

    if dataset == "material_properties":
        _numeric_check(df, ["value"], problems)
        if not problems:
            for i, row in df.iterrows():
                comp = db.get("components", str(row["component_id"]))
                if comp and row["parameter"] not in comp.get("parameters", {}):
                    problems.append(f"Row {i+2}: parameter '{row['parameter']}' is not defined for {row['component_id']} ({comp.get('model_type') or 'no model'}).")
                elif comp and float(row["value"]) <= 0 and row["parameter"] not in ("initial_crack_m", "corrosion_rate_m_per_s", "fatigue_ductility_exp"):
                    problems.append(f"Row {i+2}: parameter '{row['parameter']}' must be positive.")
        result["problems"] = problems
        if problems:
            return result
        imported = []
        if commit:
            for _, row in df.iterrows():
                comp = db.get("components", str(row["component_id"]))
                p = comp["parameters"][row["parameter"]]
                p["value"] = float(row["value"])
                if isinstance(row.get("unit"), str) and row["unit"].strip():
                    p["unit"] = row["unit"].strip()
                p["provenance"] = row.get("provenance") if isinstance(row.get("provenance"), str) else "input"
                comp["parameters"][row["parameter"]] = p
                db.upsert("components", comp)
                imported.append(f"{row['component_id']}:{row['parameter']}")
            db.log_activity("import", f"Updated {len(imported)} material parameter(s) from {filename}.", {"ids": imported})
        result.update(ok=True, imported=imported)
        return result

    if dataset == "load_history":
        _numeric_check(df, ["t_s", "stress_mpa"], problems)
        if len(set(df["component_id"].dropna().astype(str))) != 1:
            problems.append("A load_history upload must contain exactly one component_id; split mixed-component files before import.")
        if "flight_id" in df.columns:
            flight_ids = {str(v).strip() for v in df["flight_id"].dropna() if str(v).strip()}
            if len(flight_ids) > 1:
                problems.append("A load_history upload can be linked to at most one flight_id.")
            known = {f["id"]: f for f in db.list("flights")}
            bad = sorted(flight_ids - set(known))
            if bad:
                problems.append(f"Unknown flight identifier(s): {', '.join(bad)}.")
            if flight_ids and not bad:
                flight = known[next(iter(flight_ids))]
                component = db.get("components", str(df["component_id"].iloc[0]))
                if flight.get("status") != "completed":
                    problems.append(f"Flight {flight['id']} is still scheduled; load history can only be linked to a completed flight.")
                if component and flight.get("aircraft_id") != component.get("aircraft_id"):
                    problems.append(f"Flight {flight['id']} belongs to a different aircraft from component {component['id']}.")
        if not problems:
            t = pd.to_numeric(df["t_s"])
            stress = pd.to_numeric(df["stress_mpa"])
            if not t.is_monotonic_increasing:
                problems.append("t_s must be increasing.")
            if t.duplicated().any():
                problems.append("t_s must not contain duplicate sample times.")
            if len(df) < 3:
                problems.append("At least 3 samples are needed for rainflow counting.")
            if not stress.notna().all():
                problems.append("stress_mpa must contain a numeric value for every sample.")
        result["problems"] = problems
        if problems:
            return result
        bins = rainflow_bins(stress.tolist())
        summary = {
            "n_samples": int(len(df)),
            "n_cycles": float(sum(b.cycles for b in bins)),
            "max_range_mpa": float(max(b.stress_range for b in bins)) if bins else 0.0,
            "bins": [{"stress_range_mpa": b.stress_range, "cycles": b.cycles, "mean_stress_mpa": b.mean_stress} for b in bins],
        }
        imported = []
        if commit:
            component_id = str(df["component_id"].iloc[0])
            flight_id = next(iter(flight_ids), None) if "flight_id" in df.columns else None
            flight = db.get("flights", flight_id) if flight_id else None
            samples = [{"t_s": float(ti), "stress_mpa": float(si)} for ti, si in zip(t.tolist(), stress.tolist())]
            rec = db.insert("load_histories", {
                "component_id": component_id,
                "aircraft_id": (db.get("components", component_id) or {}).get("aircraft_id"),
                "flight_id": flight_id,
                "event_time": flight.get("event_time") if flight else None,
                "filename": filename,
                "source": filename,
                "provenance": "uploaded",
                "label": "UPLOADED STRESS HISTORY — PRESERVED FOR ENGINEERING REVIEW",
                "n_samples": len(samples),
                "t_s": [s["t_s"] for s in samples],
                "stress_mpa": [s["stress_mpa"] for s in samples],
                "samples": samples,
                "rainflow": summary,
                "automatic_twin_replay": False,
                "replay_note": "A stress trace is preserved with its units and chronology; it is not automatically applied to a component model without an approved load-path mapping.",
            }, "load")
            imported.append(rec["id"])
            db.insert("imports", {"dataset": dataset, "component_id": component_id, "filename": filename, "load_history_id": rec["id"], "rainflow": summary, "raw_samples_preserved": True}, "imp")
            db.log_activity("import", f"Load history {filename} preserved ({len(samples)} samples; {summary['n_cycles']:.1f} rainflow cycles).", {"ids": imported})
        result.update(ok=True, imported=imported, rainflow=summary)
        return result

    if dataset == "operational_records":
        _numeric_check(df, ["duration_min", "landing_cycles", "load_factor", "max_temperature_c"], problems)
        try:
            pd.to_datetime(df["flight_date"], errors="raise")
        except Exception:  # noqa: BLE001
            problems.append("flight_date must be an ISO date (YYYY-MM-DD).")
        if (pd.to_numeric(df["duration_min"], errors="coerce") <= 0).any():
            problems.append("duration_min must be positive.")
        if "landing_cycles" in df.columns and (pd.to_numeric(df["landing_cycles"], errors="coerce").dropna() < 0).any():
            problems.append("landing_cycles cannot be negative.")
        if "load_factor" in df.columns and (pd.to_numeric(df["load_factor"], errors="coerce").dropna() <= 0).any():
            problems.append("load_factor must be positive when supplied.")
        if "environment" in df.columns:
            be = sorted(set(df["environment"].dropna().astype(str)) - {"benign", "humid", "marine", "desert"})
            if be:
                problems.append(f"Unknown environment value(s): {', '.join(be)}. Allowed: benign, humid, marine, desert.")
        if "flight_id" in df.columns:
            known = {f["id"]: f for f in db.list("flights")}
            for idx, row in df.iterrows():
                value = row.get("flight_id")
                if pd.isna(value) or not str(value).strip():
                    continue
                flight_id = str(value).strip()
                flight = known.get(flight_id)
                if flight is None:
                    problems.append(f"Row {idx+2}: unknown flight identifier '{flight_id}'.")
                    continue
                component = db.get("components", str(row["component_id"]))
                if flight.get("status") != "completed":
                    problems.append(f"Row {idx+2}: flight {flight_id} is still scheduled; operational actuals require a completed flight.")
                if component and flight.get("aircraft_id") != component.get("aircraft_id"):
                    problems.append(f"Row {idx+2}: flight {flight_id} belongs to a different aircraft from component {component['id']}.")
        dup_cols = ["component_id", "flight_date", "flight_id"] if "flight_id" in df.columns else ["component_id", "flight_date", "duration_min"]
        dup = df.duplicated(subset=dup_cols)
        if dup.any():
            problems.append(f"Duplicate operational record row(s) at {(df.index[dup] + 2).tolist()}.")
        result["problems"] = problems
        if problems:
            return result
        imported = []
        if commit:
            numeric_fields = ("duration_min", "landing_cycles", "load_factor", "max_temperature_c")
            for _, row in df.iterrows():
                component_id = str(row["component_id"])
                component = db.get("components", component_id) or {}
                flight_id_value = row.get("flight_id") if "flight_id" in df.columns else None
                flight_id = None if pd.isna(flight_id_value) or not str(flight_id_value).strip() else str(flight_id_value).strip()
                date = pd.to_datetime(row["flight_date"]).date().isoformat()
                conditions = {
                    key: (None if key not in df.columns or pd.isna(row.get(key)) else float(row[key]))
                    for key in numeric_fields
                }
                rec = db.insert("operational_records", {
                    "component_id": component_id,
                    "aircraft_id": component.get("aircraft_id"),
                    "flight_id": flight_id,
                    "operational_date": date,
                    "event_time": f"{date}T12:00:00+00:00",
                    "conditions": conditions,
                    "environment": None if "environment" not in df.columns or pd.isna(row.get("environment")) else str(row["environment"]),
                    "notes": None if "notes" not in df.columns or pd.isna(row.get("notes")) else str(row["notes"]),
                    "provenance": "uploaded",
                    "source": filename,
                    "label": "UPLOADED OPERATIONAL SUMMARY — NOT SENSOR OBSERVATION",
                    "automatic_twin_replay": False,
                    "replay_note": "This summary is stored as operational evidence. It does not create a synthetic flight or sensor observation; link/import the corresponding completed flight and observations separately.",
                }, "opr")
                imported.append(rec["id"])
            db.insert("imports", {"dataset": dataset, "filename": filename, "operational_record_ids": imported, "rows": len(imported), "provenance": "uploaded"}, "imp")
            db.log_activity("import", f"Imported {len(imported)} traceable operational summary record(s) from {filename}.", {"ids": imported})
        result.update(ok=True, imported=imported)
        return result

    if dataset == "flight_schedule":
        _numeric_check(df, ["duration_min", "landing_cycles", "payload_fraction", "expected_temperature_c"], problems)
        known_ac = {a["id"] for a in db.list("aircraft")}
        bad = sorted(set(df["aircraft_id"].dropna().astype(str)) - known_ac)
        if bad:
            problems.append(f"Unknown aircraft identifier(s): {', '.join(bad)}.")
        try:
            pd.to_datetime(df["flight_date"], errors="raise")
        except Exception:  # noqa: BLE001
            problems.append("flight_date must be an ISO date (YYYY-MM-DD).")
        if "expected_environment" in df.columns:
            be = sorted(set(df["expected_environment"].dropna().astype(str)) - {"benign", "humid", "marine", "desert"})
            if be:
                problems.append(f"Unknown expected_environment value(s): {', '.join(be)}.")
        if "payload_fraction" in df.columns and ((pd.to_numeric(df["payload_fraction"], errors="coerce") < 0) | (pd.to_numeric(df["payload_fraction"], errors="coerce") > 1)).any():
            problems.append("payload_fraction must be between 0 and 1.")
        result["problems"] = problems
        if problems:
            return result
        imported = []
        if commit:
            for _, row in df.iterrows():
                ac = str(row["aircraft_id"])
                seq = max([f["sequence"] for f in db.list_fields("flights", ["sequence"], {"aircraft_id": ac})] + [0]) + 1
                sched = {k: (None if pd.isna(row.get(k)) else (float(row[k]) if k in ("duration_min", "payload_fraction", "expected_temperature_c") else int(row[k]) if k == "landing_cycles" else str(row[k]))) for k in ("duration_min", "landing_cycles", "payload_fraction", "expected_temperature_c", "expected_environment", "notes") if k in df.columns}
                sched["route"] = str(row["route_or_mission"]); sched["source"] = f"imported schedule ({filename})"
                if sched.get("landing_cycles") is None:
                    sched["landing_cycles"] = 1
                f = db.insert("flights", {"id": f"{ac.replace('AIRCRAFT-', 'AC')}-F{seq:04d}", "aircraft_id": ac, "sequence": seq, "flight_date": str(row["flight_date"])[:10], "event_time": f"{str(row['flight_date'])[:10]}T10:00:00+00:00", "route_or_mission": str(row["route_or_mission"]), "scheduled": sched, "actual": None, "status": "scheduled", "provenance": "uploaded"}, "flt")
                imported.append(f["id"])
            db.log_activity("import", f"Imported {len(imported)} scheduled flight(s) from {filename}.", {"ids": imported})
        result.update(ok=True, imported=imported)
        return result

    if dataset == "flight_actuals":
        _numeric_check(df, ["duration_min", "landing_cycles", "load_factor", "load_variation", "manoeuvre_intensity", "temperature_c", "pressure_factor", "vibration_level", "operating_intensity"], problems)
        known = {f["id"]: f for f in db.list("flights")}
        bad = sorted(set(df["flight_id"].dropna().astype(str)) - set(known))
        if bad:
            problems.append(f"Unknown flight identifier(s): {', '.join(bad)}.")
        for fid in df["flight_id"].dropna().astype(str):
            if fid in known and known[fid]["status"] == "completed":
                problems.append(f"Flight {fid} is already completed; actual conditions cannot be overwritten.")
        if "environment" in df.columns:
            be = sorted(set(df["environment"].dropna().astype(str)) - {"benign", "humid", "marine", "desert"})
            if be:
                problems.append(f"Unknown environment value(s): {', '.join(be)}.")
        result["problems"] = problems
        if problems:
            return result
        imported = []
        if commit:
            for _, row in df.iterrows():
                f = known[str(row["flight_id"])]
                actual = {k: float(row[k]) for k in ("duration_min", "load_factor", "load_variation", "manoeuvre_intensity", "temperature_c", "pressure_factor", "vibration_level", "operating_intensity") if k in df.columns and not pd.isna(row.get(k))}
                actual["landing_cycles"] = int(row["landing_cycles"]) if "landing_cycles" in df.columns and not pd.isna(row.get("landing_cycles")) else f["scheduled"].get("landing_cycles", 1)
                if "environment" in df.columns and not pd.isna(row.get("environment")):
                    actual["environment"] = str(row["environment"])
                else:
                    actual["environment"] = f["scheduled"].get("expected_environment") or "benign"
                actual["source"] = str(row["source"]) if "source" in df.columns and not pd.isna(row.get("source")) else filename
                f["actual"] = actual; f["status"] = "completed"; f["completion_source"] = f"uploaded ({filename})"
                db.upsert("flights", f)
                imported.append(f["id"])
            db.log_activity("import", f"Imported actual conditions for {len(imported)} flight(s) from {filename}.", {"ids": imported})
        result.update(ok=True, imported=imported)
        return result

    if dataset == "maintenance_records":
        _numeric_check(df, ["damage_after_value"], problems)
        try:
            pd.to_datetime(df["maintenance_date"], errors="raise")
        except Exception:  # noqa: BLE001
            problems.append("maintenance_date must be an ISO date (YYYY-MM-DD).")
        if "repair_or_replacement" in df.columns:
            bad = sorted(set(df["repair_or_replacement"].dropna().astype(str)) - {"none", "repair", "replacement"})
            if bad:
                problems.append(f"repair_or_replacement must be none, repair or replacement (got {', '.join(bad)}).")
        if "damage_after_quantity" in df.columns:
            bq = sorted(set(df["damage_after_quantity"].dropna().astype(str)) - set(QUANTITY_UNITS))
            if bq:
                problems.append(f"Unknown damage_after_quantity value(s): {', '.join(bq)}. Allowed: {', '.join(QUANTITY_UNITS)}.")
        result["problems"] = problems
        if problems:
            return result
        imported = []
        if commit:
            from .twin import apply_maintenance

            for _, row in df.iterrows():
                comp = db.get("components", str(row["component_id"]))
                da = None
                if "damage_after_quantity" in df.columns and not pd.isna(row.get("damage_after_quantity")) and not pd.isna(row.get("damage_after_value")):
                    da = {str(row["damage_after_quantity"]): float(row["damage_after_value"])}
                rec = db.insert("maintenance", {
                    "component_id": str(row["component_id"]), "aircraft_id": comp.get("aircraft_id"), "maintenance_date": str(row["maintenance_date"])[:10], "event_time": f"{str(row['maintenance_date'])[:10]}T15:00:00+00:00",
                    "activity": str(row["activity"]), "repair_or_replacement": str(row.get("repair_or_replacement")) if "repair_or_replacement" in df.columns and not pd.isna(row.get("repair_or_replacement")) else "none",
                    "damage_before": None, "damage_after": da, "maintenance_reference": str(row.get("maintenance_reference")) if "maintenance_reference" in df.columns and not pd.isna(row.get("maintenance_reference")) else "", "provenance": "uploaded", "applied_in_history": False,
                }, "mnt")
                if comp.get("model_type"):
                    apply_maintenance(db, rec["id"])
                imported.append(rec["id"])
            db.log_activity("import", f"Imported {len(imported)} maintenance record(s) from {filename}.", {"ids": imported})
        result.update(ok=True, imported=imported)
        return result

    raise EngineError("Unhandled dataset")
