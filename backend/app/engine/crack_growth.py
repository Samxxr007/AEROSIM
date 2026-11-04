"""
Paris-law fatigue crack propagation with threshold and critical-size handling.

    da/dN = C (ΔK)^m           for ΔK_th < ΔK < ΔK_max(a)
    ΔK    = Y Δσ sqrt(π a)     (through/edge crack, constant geometry factor Y)
    a_c   = (1/π) (K_IC / (Y σ_max))^2   critical crack size from fracture toughness

Units (consistent set used throughout the engine):
    a  : metres
    Δσ : MPa
    ΔK : MPa·√m
    C  : m/cycle per (MPa·√m)^m
    K_IC: MPa·√m

Limits of validity enforced here
--------------------------------
* ΔK ≤ ΔK_th → no growth (region I).
* K_max ≥ K_IC (equivalently a ≥ a_c) → model invalid (region III / unstable); integration stops
  and the step reports `threshold_crossed`. Paris' law is not applied beyond this point.
* The integration is explicit per stress bin with sub-stepping so that a never grows by more
  than `max_rel_growth` of its current value in one sub-step (numerical stability check).
* If essential parameters (C, m, Y, K_IC, a) are missing or non-physical an EngineError is raised
  rather than returning a number.
"""
from __future__ import annotations

import math
from typing import Iterable

from .base import EngineError, StressBin


def stress_intensity_range(delta_sigma_mpa: float, a_m: float, Y: float) -> float:
    if a_m <= 0:
        raise EngineError("Crack length must be positive for ΔK evaluation.")
    return Y * delta_sigma_mpa * math.sqrt(math.pi * a_m)


def critical_crack_length(K_IC: float, sigma_max_mpa: float, Y: float) -> float:
    if K_IC <= 0 or Y <= 0:
        raise EngineError("K_IC and Y must be positive.")
    if sigma_max_mpa <= 0:
        return math.inf
    return (K_IC / (Y * sigma_max_mpa)) ** 2 / math.pi


def paris_rate(delta_K: float, C: float, m: float, delta_K_th: float = 0.0) -> float:
    """da/dN in m/cycle; zero below threshold."""
    if C <= 0 or m <= 0:
        raise EngineError("Paris parameters C and m must be positive.")
    if delta_K <= delta_K_th:
        return 0.0
    return C * (delta_K ** m)


def integrate_paris(
    a0_m: float,
    bins: Iterable[StressBin],
    C: float,
    m: float,
    Y: float,
    delta_K_th: float,
    K_IC: float,
    sigma_max_mpa: float,
    stress_ratio_R: float = 0.0,
    max_rel_growth: float = 0.02,
) -> dict:
    """Integrate crack growth through a set of constant-amplitude blocks.

    Returns dict with final crack length, growth, max ΔK seen, whether the critical size
    was reached, per-bin breakdown and the cycles actually applied before stop.
    """
    if a0_m <= 0:
        raise EngineError("Initial crack length must be positive (metres).")
    for name, v in (("C", C), ("m", m), ("Y", Y), ("K_IC", K_IC)):
        if v is None or v <= 0:
            raise EngineError(f"Crack-growth parameter '{name}' is missing or non-positive; Paris' law cannot be applied.")
    if not (0.0 <= stress_ratio_R < 1.0):
        raise EngineError("Stress ratio R must be in [0, 1).")

    a = a0_m
    a_crit = critical_crack_length(K_IC, sigma_max_mpa, Y)
    reached_critical = a >= a_crit
    breakdown = []
    max_dK = 0.0
    total_cycles_applied = 0.0
    max_rate = 0.0

    for b in bins:
        if reached_critical:
            break
        if b.cycles <= 0 or b.stress_range <= 0:
            continue
        remaining = b.cycles
        a_start = a
        cycles_in_bin = 0.0
        while remaining > 0 and not reached_critical:
            dK = stress_intensity_range(b.stress_range, a, Y)
            # K_max = ΔK / (1 - R) for positive R loading
            K_max = dK / (1.0 - stress_ratio_R)
            if K_max >= K_IC or a >= a_crit:
                reached_critical = True
                break
            rate = paris_rate(dK, C, m, delta_K_th)
            max_dK = max(max_dK, dK)
            max_rate = max(max_rate, rate)
            if rate == 0.0:
                # below threshold: no growth, consume all cycles
                cycles_in_bin += remaining
                remaining = 0.0
                break
            # sub-step so growth per step ≤ max_rel_growth * a (stability)
            n_step = min(remaining, max(1.0, (max_rel_growth * a) / rate))
            a += rate * n_step
            remaining -= n_step
            cycles_in_bin += n_step
            if a >= a_crit:
                a = a_crit
                reached_critical = True
        total_cycles_applied += cycles_in_bin
        breakdown.append(
            {
                "label": b.label,
                "stress_range_mpa": b.stress_range,
                "cycles": b.cycles,
                "cycles_applied": cycles_in_bin,
                "delta_K_start": stress_intensity_range(b.stress_range, a_start, Y),
                "growth_m": a - a_start,
            }
        )

    return {
        "a_final_m": a,
        "growth_m": a - a0_m,
        "a_critical_m": a_crit,
        "max_delta_K": max_dK,
        "max_rate_m_per_cycle": max_rate,
        "reached_critical": reached_critical,
        "cycles_applied": total_cycles_applied,
        "breakdown": breakdown,
    }


def cycles_to_critical(
    a0_m: float,
    delta_sigma_mpa: float,
    C: float,
    m: float,
    Y: float,
    delta_K_th: float,
    K_IC: float,
    sigma_max_mpa: float,
    max_cycles: float = 1e9,
) -> dict:
    """Numerically integrate constant-amplitude growth from a0 to a_c.

    Uses adaptive explicit stepping in a. Returns cycles (may be inf if below threshold).
    """
    a_crit = critical_crack_length(K_IC, sigma_max_mpa, Y)
    if a0_m >= a_crit:
        return {"cycles": 0.0, "a_critical_m": a_crit, "status": "already_critical"}
    dK0 = stress_intensity_range(delta_sigma_mpa, a0_m, Y)
    if dK0 <= delta_K_th:
        return {"cycles": math.inf, "a_critical_m": a_crit, "status": "below_threshold"}
    a = a0_m
    N = 0.0
    while a < a_crit and N < max_cycles:
        dK = stress_intensity_range(delta_sigma_mpa, a, Y)
        rate = paris_rate(dK, C, m, delta_K_th)
        if rate <= 0:
            return {"cycles": math.inf, "a_critical_m": a_crit, "status": "below_threshold"}
        da = max(0.01 * a, 1e-6)
        da = min(da, a_crit - a)
        N += da / rate
        a += da
    status = "ok" if a >= a_crit else "max_cycles_reached"
    return {"cycles": N, "a_critical_m": a_crit, "status": status}
