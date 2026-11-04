"""
Clearly-labelled engineering surrogates for mechanisms that are not treated
with a first-principles law in this prototype:

1. Parabolic oxidation (optional turbine-blade extension)
       x² = k_p · t,     k_p = k_0 · exp(-Q_ox / (R T))
   x: oxide thickness [m]; k_p [m²/s]. Standard parabolic-kinetics form.

2. Corrosion pit-depth surrogate (landing gear / airframe)
       dp/dt = r_0 · f_env                 [m/s of exposure]
   r_0: baseline pit growth rate (illustrative), f_env: environment factor
   (1.0 benign … 3.0 marine/high-humidity). Linear-in-exposure-time by
   assumption; real pitting kinetics are typically sub-linear.

3. Hydraulic actuator seal-wear / leakage surrogate
       ΔW = k_w · n_p · (p / p_ref)^α · exp(β (T − T_ref)) · (1 + γ · W)
       Q_leak = Q_0 + k_q · W
   W: dimensionless accumulated wear indicator (0 = new seal, 1 = modelled
   leakage limit). The (1 + γ W) term expresses wear acceleration as seal
   clearance opens. Empirical form with configurable coefficients; it is not
   a universal physical law.
"""
from __future__ import annotations

import math

from .base import EngineError
from .creep import R_GAS


# ---------------------------------------------------------------- oxidation
def parabolic_oxide_growth(x0_m: float, T_k: float, time_s: float, k0: float, Q_ox: float) -> float:
    if x0_m < 0 or time_s < 0:
        raise EngineError("Oxide thickness and time must be non-negative.")
    if T_k <= 0:
        raise EngineError("Temperature must be in Kelvin and positive.")
    kp = k0 * math.exp(-Q_ox / (R_GAS * T_k))
    return math.sqrt(x0_m ** 2 + kp * time_s)


# ---------------------------------------------------------------- corrosion
def pit_depth_increment(exposure_s: float, r0_m_per_s: float, env_factor: float) -> float:
    if exposure_s < 0:
        raise EngineError("Exposure time must be non-negative.")
    if r0_m_per_s < 0 or env_factor < 0:
        raise EngineError("Corrosion rate and environment factor must be non-negative.")
    return r0_m_per_s * env_factor * exposure_s


# ---------------------------------------------------------------- actuator seal wear
def seal_wear_increment(
    W: float,
    n_pressure_cycles: float,
    p_mpa: float,
    T_k: float,
    k_w: float,
    p_ref_mpa: float,
    alpha: float,
    beta: float,
    T_ref_k: float,
    gamma: float,
) -> float:
    if W < 0:
        raise EngineError("Wear indicator must be non-negative.")
    if n_pressure_cycles < 0 or p_mpa < 0:
        raise EngineError("Pressure cycles and pressure must be non-negative.")
    if p_ref_mpa <= 0 or k_w < 0:
        raise EngineError("Reference pressure must be positive and k_w non-negative.")
    if T_k <= 0:
        raise EngineError("Temperature must be in Kelvin.")
    return k_w * n_pressure_cycles * (p_mpa / p_ref_mpa) ** alpha * math.exp(beta * (T_k - T_ref_k)) * (1.0 + gamma * W)


def leakage_from_wear(W: float, Q0_lpm: float, k_q: float) -> float:
    return Q0_lpm + k_q * W
