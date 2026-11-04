"""
Stage A — operational-model calibration by recursive least squares (RLS).

Model per channel c:
    y_c(t) = θ_c · x_c(t) + e(t)

where x_c is the twin's *baseline* channel (prediction with the calibratable
response factor removed) and θ_c is the response factor to be identified.
For temperature channels the regression is on the rise above ambient.

Scalar RLS with forgetting factor λ:
    K = P x / (λ + x P x)
    θ ← θ + K (y − θ x)
    P ← (P − K x P) / λ

The simplest estimator that can be validated correctly was chosen on purpose.
No Kalman filter is used because the parameter is modelled as constant between
updates and the measurement model is linear.

Only `response_params` are updated. The damage state is never touched here.
"""
from __future__ import annotations

from typing import Any

import numpy as np


def rls_estimate(x: np.ndarray, y: np.ndarray, theta0: float, P0: float = 1.0, lam: float = 0.98) -> dict[str, Any]:
    """Run scalar RLS over paired samples (NaNs skipped). Returns estimate and its variance proxy."""
    theta = float(theta0)
    P = float(P0)
    n_used = 0
    for xi, yi in zip(x, y):
        if xi is None or yi is None or np.isnan(xi) or np.isnan(yi) or abs(xi) < 1e-9:
            continue
        K = P * xi / (lam + xi * P * xi)
        theta = theta + K * (yi - theta * xi)
        P = (P - K * xi * P) / lam
        n_used += 1
    # residual variance after fit, for a standard-error proxy
    mask = np.array([(xi is not None and yi is not None and not np.isnan(xi) and not np.isnan(yi)) for xi, yi in zip(x, y)])
    if mask.sum() > 2:
        xs = np.array(x, dtype=float)[mask]; ys = np.array(y, dtype=float)[mask]
        resid = ys - theta * xs
        s2 = float(np.var(resid, ddof=1))
        se = float(np.sqrt(s2 / max(np.sum(xs ** 2), 1e-12)))
    else:
        se = float("nan")
    return {"theta": theta, "P": P, "n_used": int(n_used), "standard_error": se}


def batch_least_squares(x: np.ndarray, y: np.ndarray) -> float:
    """Closed-form θ = Σxy/Σx² (used in tests to cross-check RLS convergence)."""
    xs = np.array(x, dtype=float); ys = np.array(y, dtype=float)
    mask = ~(np.isnan(xs) | np.isnan(ys))
    xs, ys = xs[mask], ys[mask]
    return float(np.sum(xs * ys) / np.sum(xs ** 2))
