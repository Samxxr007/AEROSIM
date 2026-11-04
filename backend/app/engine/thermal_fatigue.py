"""
Simplified thermal-cycle (low-cycle) fatigue damage.

A reduced-order constraint-based strain estimate is combined with a
Coffin–Manson-type plastic-strain life relation:

    Δε_mech = k_c · α · ΔT                   (constrained thermal strain range)
    N_f     = (Δε_mech / ε_f')^(1 / c)       (Coffin–Manson, c < 0)
    ΔD_th   = n_cycles / N_f

Where
    k_c : constraint factor (0–1), how much of the free thermal strain is suppressed
    α   : coefficient of thermal expansion [1/K]
    ΔT  : temperature range of the thermal cycle [K]
    ε_f': fatigue ductility coefficient [-]
    c   : fatigue ductility exponent [-], negative

This is an engineering surrogate with illustrative coefficients. It ignores
elastic strain-life terms, mean-strain effects, hold-time interaction with
creep and the actual thermal gradient through the blade wall.
"""
from __future__ import annotations

import math

from .base import EngineError


def thermal_strain_range(delta_T_k: float, alpha: float, k_constraint: float) -> float:
    if delta_T_k < 0:
        raise EngineError("Temperature range must be non-negative.")
    if alpha <= 0:
        raise EngineError("Thermal expansion coefficient must be positive.")
    if not (0.0 <= k_constraint <= 1.0):
        raise EngineError("Constraint factor must be in [0, 1].")
    return k_constraint * alpha * delta_T_k


def coffin_manson_cycles(delta_eps: float, eps_f: float, c: float) -> float:
    if eps_f <= 0:
        raise EngineError("Fatigue ductility coefficient must be positive.")
    if c >= 0:
        raise EngineError("Fatigue ductility exponent c must be negative.")
    if delta_eps <= 0:
        return math.inf
    # Δε/2 = ε_f' (2N_f)^c  → 2N_f = (Δε/(2ε_f'))^(1/c)
    two_Nf = (delta_eps / (2.0 * eps_f)) ** (1.0 / c)
    return two_Nf / 2.0


def thermal_cycle_damage(n_cycles: float, delta_T_k: float, alpha: float, k_constraint: float, eps_f: float, c: float) -> dict:
    d_eps = thermal_strain_range(delta_T_k, alpha, k_constraint)
    Nf = coffin_manson_cycles(d_eps, eps_f, c)
    dmg = 0.0 if math.isinf(Nf) else n_cycles / Nf
    return {"strain_range": d_eps, "cycles_to_failure": None if math.isinf(Nf) else Nf, "damage": dmg}
