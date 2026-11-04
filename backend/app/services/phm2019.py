"""External PHM 2019 aluminum lap-joint benchmark.

This dataset is a laboratory coupon experiment, not aircraft flight telemetry.
Only training specimens T1-T6 carry crack-length ground truth. T7-T8 are
validation specimens and are deliberately excluded from supervised scoring.
"""
from __future__ import annotations

import re
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from ..config import REPO_DIR

DATA_DIR = REPO_DIR / "data" / "external" / "phm2019"
NASA_DATASET_URL = "https://data.nasa.gov/dataset/fatigue-crack-growth-in-aluminum-lap-joint"
PHM_CHALLENGE_URL = "https://data.phmsociety.org/2019datachallenge/"
MIRROR_DOWNLOAD_URL = "https://phm-datasets.s3.amazonaws.com/NASA/18.+Fatigue+Crack+Growth+in+Aluminum+Lap+Joint.zip"
TRAINING_SPECIMENS = {f"T{i}" for i in range(1, 7)}
VALIDATION_SPECIMENS = {"T7", "T8"}


def _norm(value: Any) -> str:
    return re.sub(r"[^a-z0-9]+", "_", str(value).strip().lower()).strip("_")


def _column(columns: list[Any], aliases: tuple[str, ...]) -> Any | None:
    normalized = {_norm(c): c for c in columns}
    for alias in aliases:
        for key, original in normalized.items():
            if key == alias or alias in key:
                return original
    return None


def _validate_labels(frame: pd.DataFrame, source: str) -> list[dict[str, Any]]:
    specimen_col = _column(list(frame.columns), ("specimen", "specimen_id", "test_specimen"))
    cycle_col = _column(list(frame.columns), ("cycle", "cycles", "cycle_number", "number_of_cycle"))
    crack_col = _column(list(frame.columns), ("crack_length_mm", "crack_length", "crack_len", "crack_mm"))
    if specimen_col is None or cycle_col is None or crack_col is None:
        raise ValueError(
            f"{source} must contain specimen, cycle and crack_length_mm columns. "
            "See data/external/phm2019/labels.template.csv."
        )

    rows: list[dict[str, Any]] = []
    for idx, row in frame.iterrows():
        specimen = str(row[specimen_col]).strip().upper()
        if specimen in ("", "NAN", "NONE"):
            continue
        if specimen in VALIDATION_SPECIMENS:
            raise ValueError(
                f"{specimen} is a PHM challenge validation specimen without released crack-length ground truth. "
                "Do not use it as a labelled training specimen."
            )
        if specimen not in TRAINING_SPECIMENS:
            raise ValueError(f"Unknown specimen '{specimen}' in {source}; expected T1-T6 training data.")
        try:
            cycle = float(row[cycle_col])
            crack = float(row[crack_col])
        except (TypeError, ValueError):
            continue
        if not np.isfinite(cycle) or not np.isfinite(crack):
            continue
        if cycle <= 0 or crack < 0:
            raise ValueError(f"{source} row {idx + 2}: cycle must be positive and crack length non-negative.")
        rows.append({"specimen": specimen, "cycle": int(round(cycle)), "crack_length_mm": crack})

    if not rows:
        raise ValueError(f"No valid labelled crack-growth observations were found in {source}.")
    result = pd.DataFrame(rows)
    dup = result.duplicated(["specimen", "cycle"], keep=False)
    if dup.any():
        pairs = result.loc[dup, ["specimen", "cycle"]].drop_duplicates().to_dict("records")
        raise ValueError(f"Duplicate specimen/cycle labels in {source}: {pairs[:8]}.")
    for specimen, group in result.groupby("specimen"):
        ordered = group.sort_values("cycle")
        if not ordered["cycle"].is_monotonic_increasing:
            raise ValueError(f"Cycle order is invalid for {specimen}.")
    return result.sort_values(["specimen", "cycle"]).to_dict("records")


def _labels_from_workbooks(root: Path) -> tuple[list[dict[str, Any]], list[str]]:
    rows: list[dict[str, Any]] = []
    warnings: list[str] = []
    candidates = sorted(root.rglob("Description_T*.xlsx")) + sorted(root.rglob("Description_T*.xlsm"))
    for path in candidates:
        match = re.search(r"Description_(T[1-8])", path.stem, re.IGNORECASE)
        if not match:
            continue
        specimen = match.group(1).upper()
        if specimen not in TRAINING_SPECIMENS:
            continue
        try:
            sheets = pd.read_excel(path, sheet_name=None, header=None, engine="openpyxl")
        except Exception as exc:  # noqa: BLE001
            warnings.append(f"Could not read {path.name}: {exc}")
            continue

        found = False
        for sheet in sheets.values():
            for header_row in range(min(20, len(sheet))):
                header = list(sheet.iloc[header_row].values)
                cycle_idx = next((i for i, v in enumerate(header) if "cycle" in _norm(v)), None)
                crack_idx = next((i for i, v in enumerate(header) if "crack" in _norm(v) and "length" in _norm(v)), None)
                if cycle_idx is None or crack_idx is None:
                    continue
                for _, record in sheet.iloc[header_row + 1:].iterrows():
                    try:
                        cycle = float(record.iloc[cycle_idx])
                        crack = float(record.iloc[crack_idx])
                    except (TypeError, ValueError, IndexError):
                        continue
                    if np.isfinite(cycle) and np.isfinite(crack) and cycle > 0 and crack >= 0:
                        rows.append({"specimen": specimen, "cycle": int(round(cycle)), "crack_length_mm": crack})
                found = True
                break
            if found:
                break
        if not found:
            warnings.append(f"No cycle/crack-length table detected in {path.name}; export it to labels.csv if needed.")
    if not rows:
        return [], warnings
    return _validate_labels(pd.DataFrame(rows), "Description_T*.xlsx workbooks"), warnings


def _signals(root: Path, labels: list[dict[str, Any]]) -> dict[str, Any]:
    by_cycle: dict[tuple[str, int], list[dict[str, float]]] = {}
    n_files = 0
    n_unparsed = 0
    specimen_re = re.compile(r"(?i)(?:^|[/\\])((?:T[1-8]))(?:[/\\_. -]|$)")
    cycle_re = re.compile(r"(?<!\d)(\d{4,7})(?!\d)")

    for path in root.rglob("*"):
        if not path.is_file() or path.suffix.lower() not in {".csv", ".txt"}:
            continue
        if path.name.lower().startswith("labels"):
            continue
        lower = str(path).lower()
        if any(token in lower for token in ("description", "loading_profile", "loading profile", "constant_loading", "variable_loading")):
            continue
        n_files += 1
        specimen_match = specimen_re.search(str(path))
        numbers = [int(n) for n in cycle_re.findall(str(path)) if int(n) != 2019]
        if not specimen_match or not numbers:
            n_unparsed += 1
            continue
        specimen = specimen_match.group(1).upper()
        if specimen not in TRAINING_SPECIMENS:
            continue
        cycle = numbers[-1]
        try:
            data = pd.read_csv(path, sep=None, engine="python")
            data.columns = [_norm(c) for c in data.columns]
            numeric = data.apply(pd.to_numeric, errors="coerce")
            if "ch1" in numeric.columns and "ch2" in numeric.columns:
                drive = numeric["ch1"].dropna().to_numpy(dtype=float)
                received = numeric["ch2"].dropna().to_numpy(dtype=float)
            elif numeric.shape[1] >= 3:
                drive = numeric.iloc[:, 1].dropna().to_numpy(dtype=float)
                received = numeric.iloc[:, 2].dropna().to_numpy(dtype=float)
            else:
                n_unparsed += 1
                continue
            if len(drive) < 3 or len(received) < 3:
                n_unparsed += 1
                continue
            feature = {
                "actuation_rms_v": float(np.sqrt(np.mean(np.square(drive)))),
                "received_rms_v": float(np.sqrt(np.mean(np.square(received)))),
                "received_peak_to_peak_v": float(np.ptp(received)),
            }
            by_cycle.setdefault((specimen, cycle), []).append(feature)
        except Exception:  # noqa: BLE001
            n_unparsed += 1

    merged: dict[tuple[str, int], dict[str, float]] = {
        key: {name: float(np.mean([entry[name] for entry in values])) for name in values[0]}
        for key, values in by_cycle.items()
    }
    label_lookup = {(row["specimen"], row["cycle"]): row["crack_length_mm"] for row in labels}
    joined = [
        {"specimen": specimen, "cycle": cycle, **feature, "crack_length_mm": label_lookup[(specimen, cycle)]}
        for (specimen, cycle), feature in merged.items()
        if (specimen, cycle) in label_lookup
    ]
    correlations: dict[str, float | None] = {}
    for feature in ("actuation_rms_v", "received_rms_v", "received_peak_to_peak_v"):
        x = np.array([r[feature] for r in joined], dtype=float)
        y = np.array([r["crack_length_mm"] for r in joined], dtype=float)
        correlations[feature] = (
            float(np.corrcoef(x, y)[0, 1])
            if len(x) >= 3 and np.std(x) > 0 and np.std(y) > 0 else None
        )
    return {
        "files_found": n_files,
        "files_unparsed": n_unparsed,
        "cycles_with_signal_features": len(merged),
        "labelled_cycles_with_signals": len(joined),
        "feature_correlations_with_crack_length": correlations,
        "note": "Signal-feature correlations are descriptive only; no signal-to-crack ML model is trained by this benchmark.",
    }


def _rolling_origin(labels: list[dict[str, Any]]) -> dict[str, Any]:
    grouped: dict[str, list[dict[str, Any]]] = {}
    for row in labels:
        grouped.setdefault(row["specimen"], []).append(row)

    predictions: list[dict[str, Any]] = []
    by_specimen: list[dict[str, Any]] = []
    for specimen, history in sorted(grouped.items()):
        history = sorted(history, key=lambda row: row["cycle"])
        specimen_predictions = []
        for index in range(2, len(history)):
            prior = history[:index]
            target = history[index]
            last_value = float(prior[-1]["crack_length_mm"])
            last_prediction = last_value
            x = np.array([r["cycle"] - prior[0]["cycle"] for r in prior], dtype=float)
            y = np.array([r["crack_length_mm"] for r in prior], dtype=float)
            slope, intercept = np.polyfit(x, y, 1)
            trend_prediction = max(last_value, 0.0, float(intercept + slope * (target["cycle"] - prior[0]["cycle"])))
            entry = {
                "specimen": specimen, "cycle": int(target["cycle"]), "actual_mm": float(target["crack_length_mm"]),
                "last_value_mm": last_prediction, "linear_trend_mm": trend_prediction,
            }
            predictions.append(entry)
            specimen_predictions.append(entry)
        if specimen_predictions:
            actual = np.array([p["actual_mm"] for p in specimen_predictions])
            last = np.array([p["last_value_mm"] for p in specimen_predictions])
            trend = np.array([p["linear_trend_mm"] for p in specimen_predictions])
            by_specimen.append({
                "specimen": specimen, "labelled_points": len(history), "scored_points": len(specimen_predictions),
                "last_value_mae_mm": float(np.mean(np.abs(actual - last))),
                "linear_trend_mae_mm": float(np.mean(np.abs(actual - trend))),
                "last_value_rmse_mm": float(np.sqrt(np.mean(np.square(actual - last)))),
                "linear_trend_rmse_mm": float(np.sqrt(np.mean(np.square(actual - trend)))),
            })

    if predictions:
        actual = np.array([p["actual_mm"] for p in predictions])
        last = np.array([p["last_value_mm"] for p in predictions])
        trend = np.array([p["linear_trend_mm"] for p in predictions])
        summary = {
            "scored_points": len(predictions),
            "last_value_mae_mm": float(np.mean(np.abs(actual - last))),
            "linear_trend_mae_mm": float(np.mean(np.abs(actual - trend))),
            "last_value_rmse_mm": float(np.sqrt(np.mean(np.square(actual - last)))),
            "linear_trend_rmse_mm": float(np.sqrt(np.mean(np.square(actual - trend)))),
        }
    else:
        summary = {"scored_points": 0, "last_value_mae_mm": None, "linear_trend_mae_mm": None, "last_value_rmse_mm": None, "linear_trend_rmse_mm": None}
    return {"summary": summary, "by_specimen": by_specimen, "predictions": predictions}


def build_report(data_dir: Path | str | None = None) -> dict[str, Any]:
    root = Path(data_dir) if data_dir is not None else DATA_DIR
    labels_file = root / "labels.csv"
    warnings: list[str] = []
    try:
        if labels_file.exists():
            labels = _validate_labels(pd.read_csv(labels_file), str(labels_file))
            labels_source = "local labels.csv"
        else:
            labels, warnings = _labels_from_workbooks(root)
            labels_source = "Description_T1-T6 workbook tables"
    except Exception as exc:  # noqa: BLE001
        return {
            "status": "invalid", "dataset": "PHM 2019 Fatigue Crack Growth in Aluminum Lap Joint",
            "data_directory": str(root), "error": str(exc), "warnings": warnings,
            "source_url": NASA_DATASET_URL, "challenge_url": PHM_CHALLENGE_URL,
        }

    if not labels:
        return {
            "status": "not_ready", "dataset": "PHM 2019 Fatigue Crack Growth in Aluminum Lap Joint",
            "data_directory": str(root), "labels_loaded": 0, "specimens": [],
            "source_url": NASA_DATASET_URL, "challenge_url": PHM_CHALLENGE_URL,
            "download_url": MIRROR_DOWNLOAD_URL,
            "instructions": [
                "Download the PHMDC2019_Data.zip archive and extract it under data/external/phm2019/raw/.",
                "The backend reads Description_T1-T6 Excel workbooks for optical crack-length ground truth.",
                "Alternatively, place labels.csv beside raw/ with columns: specimen,cycle,crack_length_mm.",
                "T7 and T8 are validation specimens with no released crack-length ground truth; they are never scored.",
            ],
            "warnings": warnings,
        }

    signal_report = _signals(root, labels)
    rolling = _rolling_origin(labels)
    return {
        "status": "ready", "dataset": "PHM 2019 Fatigue Crack Growth in Aluminum Lap Joint",
        "data_directory": str(root), "labels_source": labels_source,
        "labels_loaded": len(labels), "specimens": sorted({r["specimen"] for r in labels}),
        "labelled_points_by_specimen": [
            {"specimen": specimen, "points": sum(1 for r in labels if r["specimen"] == specimen)}
            for specimen in sorted({r["specimen"] for r in labels})
        ],
        "signal_features": signal_report, "rolling_origin": rolling, "warnings": warnings,
        "method_note": "Within-specimen rolling-origin one-step-ahead validation. Each forecast uses only earlier crack-length labels from the same specimen. Comparators are last-value carry-forward and a monotone-clipped linear trend; this is not a calibrated Paris-law model or a remaining-life validation.",
        "provenance_note": "Experimental aluminum lap-joint coupon data. Not aircraft flight telemetry and not a direct validation of AeroSim aircraft component models.",
        "source_url": NASA_DATASET_URL, "challenge_url": PHM_CHALLENGE_URL,
    }
