"""
S-N (Basquin-type) fatigue and Miner's linear cumulative damage.

Equations
---------
Cycles to failure at a given stress range:

    N(Δσ) = A / Δσ^m                         (Basquin form, Δσ in MPa)

with an optional endurance (fatigue) limit Δσ_e below which the model assumes
no damage (N → ∞).  This is the conventional constant-amplitude S-N treatment
used for preliminary structural fatigue assessment.

Cumulative damage (Palmgren–Miner):

    D = Σ_i n_i / N_i

D = 1 is treated as the conventional model threshold. It is *not* a guarantee
of failure; scatter in real S-N data is large and Miner's rule is known to be
non-conservative for some load sequences.

Rainflow counting of a stress time series uses the `rainflow` package
(ASTM E1049-85 four-point method) when a time series is supplied.
"""
from __future__ import annotations

import math
from typing import Iterable, Sequence

from .base import EngineError, StressBin


def cycles_to_failure(stress_range_mpa: float, A: float, m: float, endurance_limit_mpa: float = 0.0) -> float:
    """Basquin S-N: N = A / Δσ^m. Returns math.inf below the endurance limit."""
    if A <= 0 or m <= 0:
        raise EngineError("S-N parameters A and m must be positive.")
    if stress_range_mpa < 0:
        raise EngineError("Stress range must be non-negative (MPa).")
    if stress_range_mpa <= endurance_limit_mpa or stress_range_mpa == 0:
        return math.inf
    return A / (stress_range_mpa ** m)


def miner_damage(bins: Iterable[StressBin], A: float, m: float, endurance_limit_mpa: float = 0.0) -> tuple[float, list[dict]]:
    """Sum n_i / N_i over stress-range bins. Returns (damage, per-bin breakdown)."""
    total = 0.0
    breakdown: list[dict] = []
    for b in bins:
        if b.cycles < 0:
            raise EngineError(f"Negative cycle count in bin '{b.label}'.")
        N = cycles_to_failure(b.stress_range, A, m, endurance_limit_mpa)
        d = 0.0 if math.isinf(N) else b.cycles / N
        total += d
        breakdown.append(
            {
                "label": b.label,
                "stress_range_mpa": b.stress_range,
                "cycles": b.cycles,
                "cycles_to_failure": None if math.isinf(N) else N,
                "damage": d,
            }
        )
    return total, breakdown


def rainflow_bins(stress_series_mpa: Sequence[float], n_bins: int | None = None) -> list[StressBin]:
    """Rainflow-count a stress time series into StressBin objects.

    Uses the `rainflow` package (ASTM E1049-85). Half cycles are counted as 0.5.
    """
    try:
        import rainflow  # type: ignore
    except ImportError as exc:  # pragma: no cover
        raise EngineError("rainflow package is required for time-series counting") from exc

    series = [float(x) for x in stress_series_mpa]
    if len(series) < 3:
        raise EngineError("A stress history needs at least 3 samples for rainflow counting.")
    if any(x != x for x in series):
        raise EngineError("Stress history contains NaN values.")

    bins: list[StressBin] = []
    if n_bins:
        # binned output: (range, mean, count, i_start, i_end) is the extended form; use binned helper
        counted = rainflow.count_cycles(series, nbins=n_bins)
        for rng, count in counted:
            if count > 0 and rng > 0:
                bins.append(StressBin(stress_range=float(rng), cycles=float(count), label="rainflow"))
    else:
        for rng, mean, count, _i0, _i1 in rainflow.extract_cycles(series):
            if rng > 0:
                bins.append(StressBin(stress_range=float(rng), cycles=float(count), mean_stress=float(mean), label="rainflow"))
    return bins


def equivalent_constant_amplitude(bins: Iterable[StressBin], m: float) -> tuple[float, float]:
    """Collapse variable-amplitude bins to an equivalent Δσ_eq at the total cycle count.

    Δσ_eq = ( Σ n_i Δσ_i^m / Σ n_i )^(1/m)   (same damage under Basquin exponent m)
    """
    num = 0.0
    n_tot = 0.0
    for b in bins:
        num += b.cycles * (b.stress_range ** m)
        n_tot += b.cycles
    if n_tot == 0:
        return 0.0, 0.0
    return (num / n_tot) ** (1.0 / m), n_tot
