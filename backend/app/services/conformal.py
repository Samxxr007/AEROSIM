"""Chronological split-conformal intervals for flight-level RUL residuals.

Calibration uses absolute errors from completed predictions only, sorted by
flight event time. The finite-sample quantile is ceil((n+1)*(1-alpha))/n.
Coverage is marginal and relies on exchangeability; time dependence and
distribution shift must be assessed, not assumed away.
"""
from __future__ import annotations

import math
from typing import Any


def conformal_quantile(scores: list[float], alpha: float) -> float:
    if not 0 < alpha < 1:
        raise ValueError("alpha must be strictly between 0 and 1")
    clean = sorted(float(x) for x in scores if math.isfinite(float(x)) and float(x) >= 0)
    if not clean:
        raise ValueError("At least one finite, non-negative calibration score is required")
    n = len(clean)
    rank = min(n, math.ceil((n + 1) * (1 - alpha)))
    return clean[rank - 1]


def calibrate_rul(
    records: list[dict[str, Any]],
    point_estimate: float,
    alpha: float = 0.10,
    min_calibration: int = 20,
) -> dict[str, Any]:
    """Records need event_time, predicted_rul and actual_rul; earlier records only."""
    if point_estimate < 0 or not math.isfinite(point_estimate):
        raise ValueError("point_estimate must be finite and non-negative")
    ordered = sorted(records, key=lambda row: str(row.get("event_time") or ""))
    scores: list[float] = []
    used: list[str] = []
    for row in ordered:
        if row.get("predicted_rul") is None or row.get("actual_rul") is None:
            continue
        pred, actual = float(row["predicted_rul"]), float(row["actual_rul"])
        if not (math.isfinite(pred) and math.isfinite(actual)) or pred < 0 or actual < 0:
            continue
        scores.append(abs(actual - pred))
        used.append(str(row.get("flight_id") or row.get("event_time") or len(used)))
    if len(scores) < min_calibration:
        return {
            "status": "insufficient_calibration_data",
            "calibrated": False,
            "alpha": alpha,
            "target_marginal_coverage": 1 - alpha,
            "calibration_count": len(scores),
            "minimum_required": min_calibration,
            "point_estimate": point_estimate,
            "interval": None,
            "reason": "Insufficient chronological, completed-flight RUL residuals; do not label Monte Carlo percentiles as calibrated.",
            "assumptions": ["Calibration records must precede the prediction being calibrated.", "Exchangeability may fail for sequential flights and under operating-regime shift."],
        }
    q = conformal_quantile(scores, alpha)
    lower = max(0.0, point_estimate - q)
    upper = point_estimate + q
    covered = sum(1 for score in scores if score <= q) / len(scores)
    return {
        "status": "calibrated_on_available_history",
        "calibrated": True,
        "method": "chronological split conformal, absolute residual score",
        "alpha": alpha,
        "target_marginal_coverage": 1 - alpha,
        "calibration_count": len(scores),
        "minimum_required": min_calibration,
        "quantile": q,
        "point_estimate": point_estimate,
        "interval": {"lower": lower, "upper": upper, "unit": "flights"},
        "interval_width": upper - lower,
        "empirical_calibration_coverage": covered,
        "calibration_flight_ids": used,
        "assumptions": [
            "Finite-sample marginal coverage requires exchangeability of calibration and future residuals.",
            "Sequential aircraft observations can be dependent; marginal coverage is not a per-flight guarantee.",
            "Distribution shift and operating-regime changes can invalidate nominal coverage.",
            "Chronological ordering prevents future residuals from leaking into earlier predictions but does not itself guarantee exchangeability.",
        ],
    }
