"""
Norton (power-law) secondary creep.

    ε̇ = A σ^n exp(-Q / (R T))

    ε̇ : creep strain rate [1/s]
    A  : material coefficient [1/s · MPa^-n]  (illustrative demonstration value)
    σ  : applied stress [MPa]
    n  : stress exponent [-]
    Q  : activation energy [J/mol]
    R  : 8.314 J/(mol·K)
    T  : absolute temperature [K]

Creep strain is integrated over hot time with the trapezoidal rule when a
(σ, T) history is supplied, or analytically for constant conditions.
This reduced-order secondary-creep model does not represent primary or
tertiary creep and does not replace a full thermomechanical blade assessment.
"""
from __future__ import annotations

import math
from typing import Sequence

from .base import EngineError

R_GAS = 8.314  # J/(mol K)


def creep_strain_rate(sigma_mpa: float, T_k: float, A: float, n: float, Q: float) -> float:
    if T_k <= 0:
        raise EngineError("Temperature must be absolute (Kelvin) and positive.")
    if A <= 0 or n <= 0 or Q <= 0:
        raise EngineError("Creep parameters A, n and Q must be positive.")
    if sigma_mpa < 0:
        raise EngineError("Stress must be non-negative (MPa).")
    if sigma_mpa == 0:
        return 0.0
    return A * (sigma_mpa ** n) * math.exp(-Q / (R_GAS * T_k))


def creep_strain_increment(sigma_mpa: float, T_k: float, time_s: float, A: float, n: float, Q: float) -> float:
    if time_s < 0:
        raise EngineError("Exposure time must be non-negative.")
    return creep_strain_rate(sigma_mpa, T_k, A, n, Q) * time_s


def integrate_creep_history(
    sigma_mpa: Sequence[float], T_k: Sequence[float], t_s: Sequence[float], A: float, n: float, Q: float
) -> float:
    """Trapezoidal integration of the strain rate over a (σ, T, t) history."""
    if not (len(sigma_mpa) == len(T_k) == len(t_s)):
        raise EngineError("σ, T and t histories must have the same length.")
    if len(t_s) < 2:
        return 0.0
    total = 0.0
    for i in range(1, len(t_s)):
        dt = t_s[i] - t_s[i - 1]
        if dt < 0:
            raise EngineError("Time history must be monotonically non-decreasing.")
        r0 = creep_strain_rate(sigma_mpa[i - 1], T_k[i - 1], A, n, Q)
        r1 = creep_strain_rate(sigma_mpa[i], T_k[i], A, n, Q)
        total += 0.5 * (r0 + r1) * dt
    return total


def time_to_strain_limit(sigma_mpa: float, T_k: float, strain_now: float, strain_limit: float, A: float, n: float, Q: float) -> float:
    """Hours of continuous exposure at (σ, T) until the creep-strain limit is reached."""
    if strain_now >= strain_limit:
        return 0.0
    rate = creep_strain_rate(sigma_mpa, T_k, A, n, Q)
    if rate <= 0:
        return math.inf
    return (strain_limit - strain_now) / rate / 3600.0
