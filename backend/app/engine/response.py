"""
Operational response model: mission definition → component loading and predicted
flight channels (load, strain, temperature, pressure, vibration time series).

This is the *operational* part of the digital twin. It is deliberately separate
from the degradation models so that Stage-A learning may correct response
parameters (how a mission translates into stress/temperature at the component)
without touching the damage state.

Calibratable response parameters (per component):
    load_transfer_factor       k_L  multiplies mission load → component stress
    thermal_response_factor    k_T  multiplies mission thermal severity → component temperature rise
    vibration_response_factor  k_V  multiplies mission vibration level → component vibration / HCF stress
    pressure_response_factor   k_P  multiplies system pressure → pressure seen by the component

Mission phases: taxi, takeoff, climb, cruise, manoeuvring, descent, landing.
Each phase has a component-specific table of load / temperature / vibration /
pressure fractions relative to the component's reference values. The fraction
tables are documented engineering assumptions (see MODEL_ASSUMPTIONS.md).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from .base import EngineError, FlightLoading, StressBin

PHASES = ["taxi", "takeoff", "climb", "cruise", "manoeuvring", "descent", "landing"]

# Default share of flight duration per phase (fraction of total).
DEFAULT_PHASE_FRACTIONS = {
    "taxi": 0.08,
    "takeoff": 0.02,
    "climb": 0.15,
    "cruise": 0.50,
    "manoeuvring": 0.10,
    "descent": 0.10,
    "landing": 0.05,
}

ENVIRONMENT_FACTORS = {"benign": 1.0, "humid": 1.6, "marine": 2.5, "desert": 1.3}

# Per-component per-phase fractions of reference load / thermal severity / vibration / pressure
# (load, thermal, vibration, pressure)
PHASE_TABLES: dict[str, dict[str, tuple[float, float, float, float]]] = {
    "engine_mount": {
        "taxi": (0.15, 0.20, 0.40, 1.0),
        "takeoff": (1.00, 1.00, 1.00, 1.0),
        "climb": (0.85, 0.90, 0.85, 1.0),
        "cruise": (0.60, 0.70, 0.60, 1.0),
        "manoeuvring": (0.75, 0.75, 0.80, 1.0),
        "descent": (0.30, 0.45, 0.50, 1.0),
        "landing": (0.45, 0.40, 0.70, 1.0),
    },
    "landing_gear": {
        "taxi": (0.45, 0.10, 0.60, 1.0),
        "takeoff": (0.70, 0.15, 0.80, 1.0),
        "climb": (0.00, 0.05, 0.05, 1.0),
        "cruise": (0.00, 0.00, 0.02, 1.0),
        "manoeuvring": (0.00, 0.00, 0.05, 1.0),
        "descent": (0.00, 0.00, 0.05, 1.0),
        "landing": (1.00, 0.30, 1.00, 1.0),
    },
    "turbine_blade": {
        "taxi": (0.30, 0.60, 0.40, 0.35),
        "takeoff": (1.00, 1.00, 1.00, 1.00),
        "climb": (0.92, 0.96, 0.90, 0.92),
        "cruise": (0.75, 0.88, 0.70, 0.80),
        "manoeuvring": (0.85, 0.93, 0.85, 0.88),
        "descent": (0.40, 0.70, 0.50, 0.50),
        "landing": (0.35, 0.62, 0.45, 0.40),
    },
    "hydraulic_actuator": {
        "taxi": (0.40, 0.50, 0.40, 1.0),
        "takeoff": (0.80, 0.70, 1.00, 1.0),
        "climb": (0.60, 0.85, 0.70, 1.0),
        "cruise": (0.35, 1.00, 0.40, 1.0),
        "manoeuvring": (1.00, 0.95, 0.90, 1.0),
        "descent": (0.50, 0.80, 0.60, 1.0),
        "landing": (0.85, 0.65, 0.95, 1.0),
    },
}

# Actuation (pressure-cycle) counts per phase for the hydraulic actuator, per hour of phase
ACTUATION_RATE_PER_HOUR = {
    "taxi": 120.0,
    "takeoff": 450.0,
    "climb": 180.0,
    "cruise": 60.0,
    "manoeuvring": 720.0,
    "descent": 240.0,
    "landing": 540.0,
}


@dataclass
class Mission:
    """A single future flight definition (validated at API level)."""

    name: str = "Normal mission"
    profile: str = "normal"
    duration_min: float = 120.0
    landing_cycles: int = 1
    load_factor: float = 1.0
    load_variation: float = 0.10
    manoeuvre_intensity: float = 1.0
    temperature_c: float = 15.0
    pressure_factor: float = 1.0
    vibration_level: float = 1.0
    environment: str = "benign"
    operating_intensity: float = 1.0
    repeat: int = 1
    phase_fractions: dict[str, float] = field(default_factory=lambda: dict(DEFAULT_PHASE_FRACTIONS))

    def validate(self) -> list[str]:
        errs = []
        if not (5 <= self.duration_min <= 1200):
            errs.append("duration_min must be between 5 and 1200 minutes")
        if not (0 <= self.landing_cycles <= 20):
            errs.append("landing_cycles must be between 0 and 20")
        if not (0.2 <= self.load_factor <= 3.0):
            errs.append("load_factor must be between 0.2 and 3.0")
        if not (0.0 <= self.load_variation <= 0.6):
            errs.append("load_variation must be between 0 and 0.6")
        if not (0.0 <= self.manoeuvre_intensity <= 5.0):
            errs.append("manoeuvre_intensity must be between 0 and 5")
        if not (-60 <= self.temperature_c <= 300):
            errs.append("temperature_c must be between -60 and 300 °C")
        if not (0.3 <= self.pressure_factor <= 2.0):
            errs.append("pressure_factor must be between 0.3 and 2.0")
        if not (0.0 <= self.vibration_level <= 5.0):
            errs.append("vibration_level must be between 0 and 5")
        if self.environment not in ENVIRONMENT_FACTORS:
            errs.append(f"environment must be one of {list(ENVIRONMENT_FACTORS)}")
        if not (0.2 <= self.operating_intensity <= 2.0):
            errs.append("operating_intensity must be between 0.2 and 2.0")
        if not (1 <= self.repeat <= 50):
            errs.append("repeat must be between 1 and 50")
        s = sum(self.phase_fractions.get(p, 0.0) for p in PHASES)
        if abs(s - 1.0) > 0.02:
            errs.append(f"phase fractions must sum to 1.0 (got {s:.3f})")
        return errs


MISSION_PRESETS: dict[str, dict[str, Any]] = {
    "normal": dict(name="Normal operation", profile="normal"),
    "increased_load": dict(name="Increased-load operation", profile="increased_load", load_factor=1.25, load_variation=0.15, operating_intensity=1.15),
    "high_temperature": dict(name="High-temperature operation", profile="high_temperature", temperature_c=45.0, operating_intensity=1.10),
    "high_manoeuvre": dict(name="High-manoeuvre-load operation", profile="high_manoeuvre", manoeuvre_intensity=2.5, load_factor=1.15, load_variation=0.25, vibration_level=1.3),
    "adverse_environment": dict(name="Adverse-environment scenario", profile="adverse_environment", environment="marine", temperature_c=32.0, vibration_level=1.2, load_variation=0.2),
}


def mission_from_preset(preset: str, **overrides: Any) -> Mission:
    if preset not in MISSION_PRESETS:
        raise EngineError(f"Unknown mission preset '{preset}'")
    kwargs = dict(MISSION_PRESETS[preset])
    kwargs.update(overrides)
    return Mission(**kwargs)


def _split_variation(stress_range: float, cycles: float, variation: float, label: str, mean: float = 0.0) -> list[StressBin]:
    """Represent load variability by a 3-point distribution (25 % low, 50 % nominal, 25 % high)."""
    if variation <= 0 or cycles <= 0 or stress_range <= 0:
        return [StressBin(stress_range, cycles, mean, label)] if cycles > 0 and stress_range > 0 else []
    return [
        StressBin(stress_range * (1 - variation), cycles * 0.25, mean, f"{label} (−{variation:.0%})"),
        StressBin(stress_range, cycles * 0.5, mean, label),
        StressBin(stress_range * (1 + variation), cycles * 0.25, mean, f"{label} (+{variation:.0%})"),
    ]


def _phase_durations(m: Mission) -> dict[str, float]:
    total_s = m.duration_min * 60.0
    return {p: total_s * m.phase_fractions.get(p, 0.0) for p in PHASES}


def _time_axis(m: Mission, sample_s: float = 30.0) -> tuple[list[float], list[str]]:
    durs = _phase_durations(m)
    t: list[float] = []
    phase_of: list[str] = []
    clock = 0.0
    for p in PHASES:
        end = clock + durs[p]
        while clock < end - 1e-9:
            t.append(clock)
            phase_of.append(p)
            clock += sample_s
    return t, phase_of


def build_flight_loading(model_type: str, params: dict[str, float], resp: dict[str, float], mission: Mission) -> FlightLoading:
    """Translate a mission into FlightLoading for one flight of the given component type."""
    if model_type not in PHASE_TABLES:
        raise EngineError(f"No response table for model type '{model_type}'.")
    errs = mission.validate()
    if errs:
        raise EngineError("Invalid mission: " + "; ".join(errs))

    kL = resp.get("load_transfer_factor", 1.0)
    kT = resp.get("thermal_response_factor", 1.0)
    kV = resp.get("vibration_response_factor", 1.0)
    kP = resp.get("pressure_response_factor", 1.0)
    table = PHASE_TABLES[model_type]
    durs = _phase_durations(mission)
    env = ENVIRONMENT_FACTORS[mission.environment]
    T_amb_k = mission.temperature_c + 273.15

    loading = FlightLoading(duration_s=mission.duration_min * 60.0, landing_cycles=mission.landing_cycles, environment_factor=env)
    bins: list[StressBin] = []

    # ------------------------------------------------------------ engine mount
    if model_type == "engine_mount":
        sigma_ref = params["reference_load_kN"] * 1e3 / params["effective_area_mm2"]  # MPa
        sigma_phase = {
            p: kL * mission.load_factor * mission.operating_intensity * table[p][0] * sigma_ref for p in PHASES
        }
        s_max = max(sigma_phase.values())
        s_min = min(sigma_phase.values())
        # one ground-air-ground cycle per flight
        bins += _split_variation(s_max - s_min, 1.0, mission.load_variation, "ground-air-ground", mean=0.5 * (s_max + s_min))
        # manoeuvre cycles: reference 20 cycles per 12 min of manoeuvring, amplitude 30 % of manoeuvre stress
        n_man = 20.0 * mission.manoeuvre_intensity * (durs["manoeuvring"] / 720.0)
        d_man = 0.30 * sigma_phase["manoeuvring"] * max(1.0, mission.manoeuvre_intensity ** 0.5)
        bins += _split_variation(d_man, n_man, mission.load_variation, "manoeuvre", mean=sigma_phase["manoeuvring"])
        # engine-induced vibration HCF cycles at representative frequency
        f_vib = params.get("vibration_frequency_hz", 25.0)
        sigma_vib_ref = params.get("vibration_stress_ref_mpa", 12.0)
        for p in PHASES:
            d_vib = kV * mission.vibration_level * table[p][2] * sigma_vib_ref
            n_vib = durs[p] * f_vib
            if n_vib > 0 and d_vib > 0:
                bins.append(StressBin(d_vib, n_vib, sigma_phase[p], f"vibration {p}"))
        # temperature: mount zone
        dT_ref = params.get("zone_temperature_rise_k", 60.0)
        T_phase = {p: T_amb_k + kT * table[p][1] * dT_ref for p in PHASES}
        loading.max_stress_mpa = s_max * (1 + mission.load_variation)
        loading.peak_temperature_k = max(T_phase.values())
        loading.mean_temperature_k = sum(T_phase[p] * durs[p] for p in PHASES) / max(loading.duration_s, 1)
        loading.channels = _channels(mission, {
            "load_kN": lambda p: sigma_phase[p] * params["effective_area_mm2"] / 1e3,
            "strain_microstrain": lambda p: sigma_phase[p] / params["youngs_modulus_gpa"] * 1e3,
            "temperature_c": lambda p: T_phase[p] - 273.15,
            "vibration_g": lambda p: kV * mission.vibration_level * table[p][2] * params.get("vibration_ref_g", 1.5),
        }, {
            "load_kN": kL, "strain_microstrain": kL, "temperature_c": None, "vibration_g": kV,
        }, T_amb_k, kT)

    # ------------------------------------------------------------ landing gear
    elif model_type == "landing_gear":
        sigma_ref = params["reference_load_kN"] * 1e3 / params["effective_area_mm2"]
        sigma_phase = {p: kL * mission.load_factor * table[p][0] * sigma_ref for p in PHASES}
        # touchdown impact cycles (one per landing), range from zero to touchdown stress
        n_td = float(mission.landing_cycles)
        bins += _split_variation(sigma_phase["landing"], n_td, mission.load_variation, "touchdown", mean=0.5 * sigma_phase["landing"])
        # taxi bump cycles at 0.5 Hz, amplitude 25 % of taxi load
        n_taxi = durs["taxi"] * 0.5
        bins += _split_variation(0.25 * sigma_phase["taxi"], n_taxi, mission.load_variation, "taxi bumps", mean=sigma_phase["taxi"])
        # take-off rotation / unloading cycle
        bins += _split_variation(sigma_phase["takeoff"], 1.0, mission.load_variation, "take-off unloading")
        # retraction / extension cycles – small mechanical load
        bins.append(StressBin(0.10 * sigma_ref, 2.0 * max(1, mission.landing_cycles), 0.0, "retraction/extension"))
        sigma_vib_ref = params.get("vibration_stress_ref_mpa", 6.0)
        for p in ("taxi", "takeoff", "landing"):
            d_vib = kV * mission.vibration_level * table[p][2] * sigma_vib_ref
            n_vib = durs[p] * params.get("vibration_frequency_hz", 8.0)
            if n_vib > 0 and d_vib > 0:
                bins.append(StressBin(d_vib, n_vib, sigma_phase[p], f"vibration {p}"))
        dT_ref = params.get("zone_temperature_rise_k", 40.0)
        T_phase = {p: T_amb_k + kT * table[p][1] * dT_ref for p in PHASES}
        loading.max_stress_mpa = sigma_phase["landing"] * (1 + mission.load_variation)
        loading.peak_temperature_k = max(T_phase.values())
        loading.mean_temperature_k = sum(T_phase[p] * durs[p] for p in PHASES) / max(loading.duration_s, 1)
        loading.channels = _channels(mission, {
            "load_kN": lambda p: sigma_phase[p] * params["effective_area_mm2"] / 1e3,
            "strain_microstrain": lambda p: sigma_phase[p] / params["youngs_modulus_gpa"] * 1e3,
            "temperature_c": lambda p: T_phase[p] - 273.15,
            "vibration_g": lambda p: kV * mission.vibration_level * table[p][2] * params.get("vibration_ref_g", 2.0),
        }, {"load_kN": kL, "strain_microstrain": kL, "temperature_c": None, "vibration_g": kV}, T_amb_k, kT)

    # ------------------------------------------------------------ turbine blade
    elif model_type == "turbine_blade":
        sigma_c_ref = params["centrifugal_stress_ref_mpa"]
        T_metal_ref = params["metal_temperature_ref_k"]
        T_ground = T_amb_k
        # metal temperature: ground temperature + kT × phase-thermal fraction × (ref rise); hot-day offset included via T_amb
        rise_ref = (T_metal_ref - 288.15) * mission.operating_intensity
        T_phase = {p: T_ground + kT * table[p][1] * rise_ref for p in PHASES}
        sigma_phase = {p: kL * mission.load_factor * mission.operating_intensity * (table[p][0] ** 2) * sigma_c_ref for p in PHASES}
        # creep-relevant: duration-weighted (σ, T) exposure (stored per phase in channels for integration)
        loading.hot_time_s = sum(durs[p] for p in PHASES if table[p][1] >= 0.85)
        loading.peak_temperature_k = max(T_phase.values())
        loading.mean_temperature_k = sum(T_phase[p] * durs[p] for p in PHASES) / max(loading.duration_s, 1)
        loading.delta_temperature_k = max(T_phase.values()) - T_ground
        # thermal cycles: 1 major start-stop cycle + throttle transients in manoeuvring
        loading.thermal_cycles = 1
        n_trans = 6.0 * mission.manoeuvre_intensity * (durs["manoeuvring"] / 720.0)
        # LCF from centrifugal start/stop (one per flight) — treated as a stress bin
        bins += _split_variation(max(sigma_phase.values()), 1.0, mission.load_variation, "start-stop centrifugal", mean=0.5 * max(sigma_phase.values()))
        bins += _split_variation(0.15 * sigma_phase["manoeuvring"], n_trans, mission.load_variation, "throttle transients", mean=sigma_phase["manoeuvring"])
        loading.max_stress_mpa = max(sigma_phase.values()) * (1 + mission.load_variation)
        loading.channels = _channels(mission, {
            "temperature_c": lambda p: T_phase[p] - 273.15,
            "load_kN": lambda p: sigma_phase[p] * params.get("root_area_mm2", 400.0) / 1e3,
            "pressure_bar": lambda p: kP * table[p][3] * params.get("gas_path_pressure_ref_bar", 28.0),
            "vibration_g": lambda p: kV * mission.vibration_level * table[p][2] * params.get("vibration_ref_g", 3.0),
        }, {"temperature_c": None, "load_kN": kL, "pressure_bar": kP, "vibration_g": kV}, T_ground, kT)
        loading.channels["phase_exposure"] = [
            {"phase": p, "duration_s": durs[p], "sigma_mpa": sigma_phase[p], "T_k": T_phase[p]} for p in PHASES
        ]
        loading.channels["throttle_transients"] = n_trans

    # ------------------------------------------------------------ hydraulic actuator
    elif model_type == "hydraulic_actuator":
        p_nom = params["nominal_pressure_mpa"]
        p_phase = {p: kP * mission.pressure_factor * table[p][3] * p_nom for p in PHASES}
        dT_ref = params.get("fluid_temperature_rise_k", 45.0)
        T_phase = {p: T_amb_k + kT * table[p][1] * dT_ref for p in PHASES}
        n_cycles = sum(ACTUATION_RATE_PER_HOUR[p] * (durs[p] / 3600.0) * (mission.manoeuvre_intensity if p == "manoeuvring" else 1.0) for p in PHASES)
        loading.pressure_cycles = int(round(n_cycles * mission.operating_intensity))
        loading.pressure_mpa = sum(p_phase[p] * durs[p] for p in PHASES) / max(loading.duration_s, 1)
        loading.peak_temperature_k = max(T_phase.values())
        loading.mean_temperature_k = sum(T_phase[p] * durs[p] for p in PHASES) / max(loading.duration_s, 1)
        F_ref = params.get("rated_force_kN", 60.0)
        loading.channels = _channels(mission, {
            "pressure_bar": lambda p: p_phase[p] * 10.0,
            "temperature_c": lambda p: T_phase[p] - 273.15,
            "load_kN": lambda p: kL * mission.load_factor * table[p][0] * F_ref,
            "vibration_g": lambda p: kV * mission.vibration_level * table[p][2] * params.get("vibration_ref_g", 1.0),
        }, {"pressure_bar": kP, "temperature_c": None, "load_kN": kL, "vibration_g": kV}, T_amb_k, kT)

    loading.stress_bins = bins
    return loading


def _channels(mission: Mission, fns: dict[str, Any], factors: dict[str, float | None], T_amb_k: float, kT: float) -> dict[str, Any]:
    """Build per-sample channel arrays with smooth transitions between phases.

    Also returns 'baseline' arrays: channel values with the calibratable response factor
    removed, used as the regressor by the Stage-A recursive least-squares estimator.
    For temperature channels the calibratable quantity is the rise above ambient:
        T = T_amb + kT * baseline_rise
    """
    import numpy as np

    t, phase_of = _time_axis(mission)
    out: dict[str, Any] = {"t_s": t, "phase": phase_of}
    baseline: dict[str, list[float]] = {}
    n = len(t)
    phase_values_cache: dict[str, float] = {}
    for name, fn in fns.items():
        phase_values_cache = {p: fn(p) for p in PHASES}
        raw = np.array([phase_values_cache[p] for p in phase_of], dtype=float)
        # 5-sample moving average (edge-truncated) to avoid unphysical step changes between phases
        if n >= 5:
            csum = np.concatenate(([0.0], np.cumsum(raw)))
            idx = np.arange(n)
            lo = np.maximum(0, idx - 2); hi = np.minimum(n, idx + 3)
            smooth = ((csum[hi] - csum[lo]) / (hi - lo)).tolist()
        else:
            smooth = raw.tolist()
        out[name] = smooth
        f = factors.get(name)
        if name == "temperature_c":
            amb = T_amb_k - 273.15
            baseline[name] = [(v - amb) / kT if kT > 0 else 0.0 for v in smooth]
        elif f:
            baseline[name] = [v / f for v in smooth]
        else:
            baseline[name] = list(smooth)
    out["baseline"] = baseline
    out["ambient_c"] = T_amb_k - 273.15
    return out


CHANNEL_UNITS = {
    "load_kN": "kN",
    "strain_microstrain": "µε",
    "temperature_c": "°C",
    "pressure_bar": "bar",
    "vibration_g": "g RMS",
}

CHANNEL_TO_RESPONSE_PARAM = {
    "load_kN": "load_transfer_factor",
    "strain_microstrain": "load_transfer_factor",
    "temperature_c": "thermal_response_factor",
    "pressure_bar": "pressure_response_factor",
    "vibration_g": "vibration_response_factor",
}
