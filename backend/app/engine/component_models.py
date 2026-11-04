"""
Composite component degradation models. Each model combines the mechanism
modules (fatigue, crack growth, creep, surrogates) with its own state and
parameter set.

All default parameter values are ILLUSTRATIVE DEMONSTRATION VALUES of the
order of magnitude reported in open engineering literature for the stated
material class. They are tagged with provenance 'assumption' and must be
replaced by qualified material data for any real assessment.
"""
from __future__ import annotations

import math
from typing import Any

from . import crack_growth as cg
from . import creep as cr
from . import fatigue as fa
from . import surrogates as su
from . import thermal_fatigue as tf
from .base import DegradationModel, EngineError, FlightLoading, Parameter, StepResult, require_positive


def _p(name, value, unit, prov="assumption", desc=""):
    return Parameter(name, value, unit, prov, desc)


def _finite(x: float) -> float | None:
    return None if (x is None or math.isinf(x) or math.isnan(x)) else x


# ===================================================================== MODEL 1
class EngineMountModel(DegradationModel):
    model_type = "engine_mount"
    display_name = "Engine mount / pylon — fatigue and crack propagation"
    mechanisms = ["fatigue_accumulation", "fatigue_crack_propagation", "corrosion (optional)"]

    def default_parameters(self) -> dict[str, Parameter]:
        return {
            # material (Ti-6Al-4V class, illustrative)
            "sn_A": _p("sn_A", 5.0e13, "MPa^m·cycles", "assumption", "Basquin coefficient A in N = A/Δσ^m (net-section S-N for the notched lug, Kt included)"),
            "sn_m": _p("sn_m", 4.0, "-", "assumption", "Basquin exponent"),
            "endurance_limit_mpa": _p("endurance_limit_mpa", 35.0, "MPa", "assumption", "Stress range below which no S-N damage is accumulated (notched, R≈0)"),
            "paris_C": _p("paris_C", 1.0e-11, "m/cycle/(MPa√m)^m", "assumption", "Paris coefficient"),
            "paris_m": _p("paris_m", 3.0, "-", "assumption", "Paris exponent"),
            "delta_K_th": _p("delta_K_th", 3.0, "MPa√m", "assumption", "Threshold stress-intensity range"),
            "K_IC": _p("K_IC", 75.0, "MPa√m", "assumption", "Plane-strain fracture toughness (upper range of the material class)"),
            "geometry_factor_Y": _p("geometry_factor_Y", 1.12, "-", "assumption", "Edge-crack geometry factor (constant)"),
            "youngs_modulus_gpa": _p("youngs_modulus_gpa", 114.0, "GPa", "catalogue", "Elastic modulus"),
            # geometry / loading
            "reference_load_kN": _p("reference_load_kN", 132.0, "kN", "input", "Reference take-off load transferred through the mount lug"),
            "effective_area_mm2": _p("effective_area_mm2", 600.0, "mm²", "input", "Effective net section of the critical lug"),
            "vibration_frequency_hz": _p("vibration_frequency_hz", 25.0, "Hz", "assumption", "Representative engine-induced vibration frequency at the mount"),
            "vibration_stress_ref_mpa": _p("vibration_stress_ref_mpa", 25.0, "MPa", "assumption", "Reference vibratory stress range at take-off (engine-induced HCF)"),
            "vibration_ref_g": _p("vibration_ref_g", 1.5, "g RMS", "assumption", "Reference vibration at take-off"),
            "zone_temperature_rise_k": _p("zone_temperature_rise_k", 60.0, "K", "assumption", "Mount-zone temperature rise above ambient at take-off"),
            "stress_ratio_R": _p("stress_ratio_R", 0.1, "-", "assumption", "Stress ratio for K_max evaluation"),
            "initial_crack_m": _p("initial_crack_m", 0.006, "m", "measured", "Initial crack length (from last inspection)"),
        }

    def default_state(self) -> dict[str, float]:
        return {"miner_damage": 0.0, "crack_length_m": 0.006, "cumulative_cycles": 0.0, "flights": 0.0, "pit_depth_m": 0.0}

    def validate_parameters(self, params: dict[str, float]) -> list[str]:
        errs: list[str] = []
        require_positive(params, ["sn_A", "sn_m", "paris_C", "paris_m", "K_IC", "geometry_factor_Y", "reference_load_kN", "effective_area_mm2", "youngs_modulus_gpa"], errs)
        if params.get("delta_K_th", 0) < 0:
            errs.append("delta_K_th must be non-negative")
        if not (0 <= params.get("stress_ratio_R", 0) < 1):
            errs.append("stress_ratio_R must be in [0,1)")
        return errs

    def step(self, state, params, loading: FlightLoading) -> StepResult:
        warnings: list[str] = []
        D0 = state.get("miner_damage", 0.0)
        a0 = state.get("crack_length_m", 0.0)
        dD, sn_breakdown = fa.miner_damage(loading.stress_bins, params["sn_A"], params["sn_m"], params.get("endurance_limit_mpa", 0.0))
        D1 = D0 + dD
        crack_out: dict[str, Any] | None = None
        a1 = a0
        if a0 > 0:
            crack_out = cg.integrate_paris(
                a0, loading.stress_bins, params["paris_C"], params["paris_m"], params["geometry_factor_Y"],
                params.get("delta_K_th", 0.0), params["K_IC"], loading.max_stress_mpa, params.get("stress_ratio_R", 0.0),
            )
            a1 = crack_out["a_final_m"]
        else:
            warnings.append("No initial crack specified: crack-propagation model not applied (fatigue initiation only).")
        n_cycles = sum(b.cycles for b in loading.stress_bins)
        # optional corrosion extension
        pit0 = state.get("pit_depth_m", 0.0)
        pit1 = pit0 + su.pit_depth_increment(loading.duration_s, params.get("corrosion_rate_m_per_s", 0.0), loading.environment_factor)

        status, detail = self._threshold(D1, a1, crack_out)
        new_state = {
            "miner_damage": D1,
            "crack_length_m": a1,
            "cumulative_cycles": state.get("cumulative_cycles", 0.0) + n_cycles,
            "flights": state.get("flights", 0.0) + 1,
            "pit_depth_m": pit1,
        }
        eq_range, n_tot = fa.equivalent_constant_amplitude(loading.stress_bins, params["sn_m"])
        outputs = {
            "max_stress_mpa": loading.max_stress_mpa,
            "equivalent_stress_range_mpa": eq_range,
            "cycles_this_flight": n_tot,
            "sn_breakdown": sn_breakdown,
            "crack": crack_out,
            "a_critical_m": crack_out["a_critical_m"] if crack_out else None,
            "crack_growth_rate_m_per_cycle": crack_out["max_rate_m_per_cycle"] if crack_out else None,
            "margin_fatigue": 1.0 - D1,
            "margin_crack": (crack_out["a_critical_m"] - a1) / crack_out["a_critical_m"] if crack_out else None,
            "peak_temperature_k": loading.peak_temperature_k,
        }
        return StepResult(new_state, {"miner_damage": dD, "crack_length_m": a1 - a0, "pit_depth_m": pit1 - pit0}, outputs, status, detail, warnings)

    def _threshold(self, D, a, crack_out):
        if crack_out and crack_out["reached_critical"]:
            return "threshold_crossed", "Crack length reached the critical size derived from K_IC; Paris' law no longer valid."
        if D >= 1.0:
            return "threshold_crossed", "Miner cumulative damage reached D = 1 (conventional S-N threshold)."
        return "within_threshold", f"D = {D:.4f} (< 1), crack {a*1e3:.3f} mm" + (f" (< a_c {crack_out['a_critical_m']*1e3:.2f} mm)" if crack_out else "")

    def remaining_life(self, state, params, ref: FlightLoading) -> dict[str, Any]:
        D = state.get("miner_damage", 0.0)
        a = state.get("crack_length_m", 0.0)
        dD, _ = fa.miner_damage(ref.stress_bins, params["sn_A"], params["sn_m"], params.get("endurance_limit_mpa", 0.0))
        fatigue_flights = (1.0 - D) / dD if dD > 0 else math.inf
        out: dict[str, Any] = {
            "unit": "flights of the reference mission",
            "fatigue_remaining_flights": _finite(fatigue_flights),
            "fatigue_damage_per_flight": dD,
        }
        if a > 0:
            # integrate the reference flight repeatedly until critical (cap)
            flights = 0
            a_run = a
            cap = 20000
            crit = False
            while flights < cap:
                r = cg.integrate_paris(a_run, ref.stress_bins, params["paris_C"], params["paris_m"], params["geometry_factor_Y"], params.get("delta_K_th", 0.0), params["K_IC"], ref.max_stress_mpa, params.get("stress_ratio_R", 0.0))
                a_run = r["a_final_m"]
                flights += 1
                if r["reached_critical"]:
                    crit = True
                    break
                if r["growth_m"] <= 0:
                    break
            out["crack_remaining_flights"] = flights if crit else None
            out["crack_remaining_note"] = None if crit else ("No growth under reference loading (below ΔK_th)" if a_run == a else f"Critical size not reached within {cap} flights")
            out["a_critical_m"] = r["a_critical_m"]
        else:
            out["crack_remaining_flights"] = None
            out["crack_remaining_note"] = "No initial crack defined"
        candidates = [v for v in (out["fatigue_remaining_flights"], out["crack_remaining_flights"]) if v is not None]
        out["governing_remaining_flights"] = min(candidates) if candidates else None
        out["governing_mechanism"] = (
            None if not candidates else ("crack_propagation" if out["crack_remaining_flights"] is not None and out["crack_remaining_flights"] == out["governing_remaining_flights"] else "fatigue_accumulation")
        )
        return out

    def equations(self):
        return [
            {"name": "Basquin S-N", "latex": "N = A / (\\Delta\\sigma)^m", "text": "N = A / Δσ^m"},
            {"name": "Miner's rule", "latex": "D = \\sum_i n_i / N_i", "text": "D = Σ nᵢ/Nᵢ"},
            {"name": "Paris' law", "latex": "da/dN = C (\\Delta K)^m", "text": "da/dN = C(ΔK)^m"},
            {"name": "Stress intensity", "latex": "\\Delta K = Y \\Delta\\sigma \\sqrt{\\pi a}", "text": "ΔK = Y·Δσ·√(πa)"},
            {"name": "Critical crack", "latex": "a_c = \\frac{1}{\\pi}\\left(\\frac{K_{IC}}{Y\\sigma_{max}}\\right)^2", "text": "a_c = (K_IC/(Y·σ_max))²/π"},
        ]

    def relevant_mission_inputs(self):
        return ["duration_min", "load_factor", "load_variation", "manoeuvre_intensity", "vibration_level", "temperature_c", "operating_intensity", "environment"]

    def uncertain_parameters(self):
        return {
            "sn_A": {"dist": "lognormal", "cov": 0.35, "class": "parameter"},
            "paris_C": {"dist": "lognormal", "cov": 0.30, "class": "parameter"},
            "crack_length_m": {"dist": "normal", "sd_abs": 0.00025, "class": "measurement", "state": True},
            "load_transfer_factor": {"dist": "normal", "cov": 0.06, "class": "operational", "response": True},
            "geometry_factor_Y": {"dist": "normal", "cov": 0.04, "class": "model_form"},
        }


# ===================================================================== MODEL 2
class LandingGearModel(DegradationModel):
    model_type = "landing_gear"
    display_name = "Landing gear structural assembly — fatigue, crack growth, corrosion"
    mechanisms = ["fatigue_accumulation", "fatigue_crack_propagation", "corrosion", "mechanical_wear (catalogue)"]

    def default_parameters(self) -> dict[str, Parameter]:
        return {
            # 300M / 4340-class high-strength steel, illustrative
            "sn_A": _p("sn_A", 6.0e15, "MPa^m·cycles", "assumption", "Basquin coefficient"),
            "sn_m": _p("sn_m", 4.2, "-", "assumption", "Basquin exponent"),
            "endurance_limit_mpa": _p("endurance_limit_mpa", 120.0, "MPa", "assumption", "Endurance limit (stress range)"),
            "paris_C": _p("paris_C", 6.0e-12, "m/cycle/(MPa√m)^m", "assumption", "Paris coefficient"),
            "paris_m": _p("paris_m", 3.0, "-", "assumption", "Paris exponent"),
            "delta_K_th": _p("delta_K_th", 5.0, "MPa√m", "assumption", "Threshold ΔK"),
            "K_IC": _p("K_IC", 55.0, "MPa√m", "assumption", "Fracture toughness"),
            "geometry_factor_Y": _p("geometry_factor_Y", 1.0, "-", "assumption", "Geometry factor (surface crack in cylinder, simplified)"),
            "youngs_modulus_gpa": _p("youngs_modulus_gpa", 205.0, "GPa", "catalogue", "Elastic modulus"),
            "reference_load_kN": _p("reference_load_kN", 420.0, "kN", "input", "Reference touchdown vertical load (limit sink rate)"),
            "effective_area_mm2": _p("effective_area_mm2", 900.0, "mm²", "input", "Net section at the critical fillet"),
            "vibration_frequency_hz": _p("vibration_frequency_hz", 8.0, "Hz", "assumption", "Taxi vibration frequency"),
            "vibration_stress_ref_mpa": _p("vibration_stress_ref_mpa", 6.0, "MPa", "assumption", "Reference vibratory stress range"),
            "vibration_ref_g": _p("vibration_ref_g", 2.0, "g RMS", "assumption", "Reference vibration during landing roll"),
            "zone_temperature_rise_k": _p("zone_temperature_rise_k", 40.0, "K", "assumption", "Brake-heat-driven temperature rise at the fillet"),
            "corrosion_rate_m_per_s": _p("corrosion_rate_m_per_s", 1.2e-12, "m/s", "assumption", "Baseline pit growth rate (benign environment); ≈38 µm/year"),
            "pit_depth_limit_m": _p("pit_depth_limit_m", 0.0005, "m", "assumption", "Pit depth triggering engineering review"),
            "stress_ratio_R": _p("stress_ratio_R", 0.0, "-", "assumption", "Stress ratio"),
            "initial_crack_m": _p("initial_crack_m", 0.0, "m", "measured", "Initial crack length (0 = no detected crack)"),
        }

    def default_state(self):
        return {"miner_damage": 0.0, "crack_length_m": 0.0, "cumulative_cycles": 0.0, "flights": 0.0, "pit_depth_m": 0.0, "landings": 0.0}

    def validate_parameters(self, params):
        errs: list[str] = []
        require_positive(params, ["sn_A", "sn_m", "reference_load_kN", "effective_area_mm2", "youngs_modulus_gpa"], errs)
        if params.get("corrosion_rate_m_per_s", 0) < 0:
            errs.append("corrosion_rate_m_per_s must be non-negative")
        return errs

    def step(self, state, params, loading: FlightLoading) -> StepResult:
        warnings: list[str] = []
        D0 = state.get("miner_damage", 0.0)
        a0 = state.get("crack_length_m", 0.0)
        pit0 = state.get("pit_depth_m", 0.0)
        dD, sn_breakdown = fa.miner_damage(loading.stress_bins, params["sn_A"], params["sn_m"], params.get("endurance_limit_mpa", 0.0))
        D1 = D0 + dD
        crack_out = None
        a1 = a0
        if a0 > 0:
            crack_out = cg.integrate_paris(a0, loading.stress_bins, params["paris_C"], params["paris_m"], params["geometry_factor_Y"], params.get("delta_K_th", 0.0), params["K_IC"], loading.max_stress_mpa, params.get("stress_ratio_R", 0.0))
            a1 = crack_out["a_final_m"]
        # corrosion: exposure = flight duration + assumed 6 h ground exposure per landing cycle
        exposure_s = loading.duration_s + 6 * 3600.0 * max(loading.landing_cycles, 1)
        pit1 = pit0 + su.pit_depth_increment(exposure_s, params.get("corrosion_rate_m_per_s", 0.0), loading.environment_factor)
        n_cycles = sum(b.cycles for b in loading.stress_bins)
        status, detail = "within_threshold", f"D = {D1:.4f}, pit {pit1*1e6:.1f} µm"
        if crack_out and crack_out["reached_critical"]:
            status, detail = "threshold_crossed", "Crack reached critical size (K_IC criterion)."
        elif D1 >= 1.0:
            status, detail = "threshold_crossed", "Miner damage reached D = 1."
        elif pit1 >= params.get("pit_depth_limit_m", math.inf):
            status, detail = "threshold_crossed", "Corrosion pit depth exceeded the review limit."
        eq_range, n_tot = fa.equivalent_constant_amplitude(loading.stress_bins, params["sn_m"])
        new_state = {
            "miner_damage": D1, "crack_length_m": a1, "pit_depth_m": pit1,
            "cumulative_cycles": state.get("cumulative_cycles", 0.0) + n_cycles,
            "flights": state.get("flights", 0.0) + 1,
            "landings": state.get("landings", 0.0) + loading.landing_cycles,
        }
        outputs = {
            "max_stress_mpa": loading.max_stress_mpa, "equivalent_stress_range_mpa": eq_range, "cycles_this_flight": n_tot,
            "sn_breakdown": sn_breakdown, "crack": crack_out,
            "a_critical_m": crack_out["a_critical_m"] if crack_out else None,
            "margin_fatigue": 1.0 - D1,
            "margin_corrosion": 1.0 - pit1 / params["pit_depth_limit_m"] if params.get("pit_depth_limit_m") else None,
            "peak_temperature_k": loading.peak_temperature_k,
        }
        return StepResult(new_state, {"miner_damage": dD, "crack_length_m": a1 - a0, "pit_depth_m": pit1 - pit0}, outputs, status, detail, warnings)

    def remaining_life(self, state, params, ref: FlightLoading):
        D = state.get("miner_damage", 0.0)
        dD, _ = fa.miner_damage(ref.stress_bins, params["sn_A"], params["sn_m"], params.get("endurance_limit_mpa", 0.0))
        exposure_s = ref.duration_s + 6 * 3600.0 * max(ref.landing_cycles, 1)
        dpit = su.pit_depth_increment(exposure_s, params.get("corrosion_rate_m_per_s", 0.0), ref.environment_factor)
        pit = state.get("pit_depth_m", 0.0)
        out = {
            "unit": "flights of the reference mission",
            "fatigue_remaining_flights": _finite((1 - D) / dD) if dD > 0 else None,
            "fatigue_damage_per_flight": dD,
            "corrosion_remaining_flights": _finite((params["pit_depth_limit_m"] - pit) / dpit) if dpit > 0 else None,
            "crack_remaining_flights": None,
            "crack_remaining_note": "No initial crack defined" if state.get("crack_length_m", 0) <= 0 else None,
        }
        a = state.get("crack_length_m", 0.0)
        if a > 0:
            flights, a_run, crit = 0, a, False
            while flights < 20000:
                r = cg.integrate_paris(a_run, ref.stress_bins, params["paris_C"], params["paris_m"], params["geometry_factor_Y"], params.get("delta_K_th", 0.0), params["K_IC"], ref.max_stress_mpa, params.get("stress_ratio_R", 0.0))
                a_run = r["a_final_m"]; flights += 1
                if r["reached_critical"]:
                    crit = True; break
                if r["growth_m"] <= 0:
                    break
            out["crack_remaining_flights"] = flights if crit else None
            out["crack_remaining_note"] = None if crit else "Critical size not reached within 20000 flights or no growth"
        cands = {k: v for k, v in (("fatigue_accumulation", out["fatigue_remaining_flights"]), ("crack_propagation", out["crack_remaining_flights"]), ("corrosion", out["corrosion_remaining_flights"])) if v is not None}
        out["governing_remaining_flights"] = min(cands.values()) if cands else None
        out["governing_mechanism"] = min(cands, key=cands.get) if cands else None
        return out

    def equations(self):
        return EngineMountModel().equations() + [{"name": "Corrosion surrogate", "latex": "dp/dt = r_0 f_{env}", "text": "dp/dt = r₀·f_env (linear pit-growth surrogate)"}]

    def relevant_mission_inputs(self):
        return ["duration_min", "landing_cycles", "load_factor", "load_variation", "vibration_level", "temperature_c", "environment"]

    def uncertain_parameters(self):
        return {
            "sn_A": {"dist": "lognormal", "cov": 0.40, "class": "parameter"},
            "load_transfer_factor": {"dist": "normal", "cov": 0.08, "class": "operational", "response": True},
            "corrosion_rate_m_per_s": {"dist": "lognormal", "cov": 0.5, "class": "parameter"},
        }


# ===================================================================== MODEL 3
class TurbineBladeModel(DegradationModel):
    model_type = "turbine_blade"
    display_name = "HP turbine blade — creep, thermal fatigue, oxidation"
    mechanisms = ["creep", "thermal_fatigue", "oxidation (optional)"]

    def default_parameters(self):
        return {
            # Ni-base superalloy class, illustrative Norton parameters
            "creep_A": _p("creep_A", 4.3e-8, "1/s·MPa^-n", "assumption", "Norton coefficient (gives ε̇≈1e-9 /s at 250 MPa, 1150 K)"),
            "creep_n": _p("creep_n", 5.0, "-", "assumption", "Stress exponent"),
            "creep_Q": _p("creep_Q", 300000.0, "J/mol", "assumption", "Activation energy"),
            "creep_strain_limit": _p("creep_strain_limit", 0.01, "-", "assumption", "Creep strain at which engineering review is required (1 %)"),
            "cte_alpha": _p("cte_alpha", 1.4e-5, "1/K", "catalogue", "Coefficient of thermal expansion"),
            "constraint_factor": _p("constraint_factor", 0.35, "-", "assumption", "Fraction of thermal strain suppressed by constraint"),
            "fatigue_ductility_coeff": _p("fatigue_ductility_coeff", 0.25, "-", "assumption", "Coffin–Manson ε_f'"),
            "fatigue_ductility_exp": _p("fatigue_ductility_exp", -0.6, "-", "assumption", "Coffin–Manson exponent c"),
            "oxidation_k0": _p("oxidation_k0", 2.0e-6, "m²/s", "assumption", "Parabolic oxidation pre-exponential"),
            "oxidation_Q": _p("oxidation_Q", 250000.0, "J/mol", "assumption", "Oxidation activation energy"),
            "oxide_limit_m": _p("oxide_limit_m", 3.0e-5, "m", "assumption", "Oxide thickness review limit (30 µm)"),
            "centrifugal_stress_ref_mpa": _p("centrifugal_stress_ref_mpa", 260.0, "MPa", "input", "Blade-root centrifugal stress at 100 % N2"),
            "metal_temperature_ref_k": _p("metal_temperature_ref_k", 1160.0, "K", "input", "Blade metal temperature at take-off (ISA)"),
            "root_area_mm2": _p("root_area_mm2", 400.0, "mm²", "input", "Root load-bearing area"),
            "gas_path_pressure_ref_bar": _p("gas_path_pressure_ref_bar", 28.0, "bar", "assumption", "Reference HPT inlet pressure"),
            "vibration_ref_g": _p("vibration_ref_g", 3.0, "g RMS", "assumption", "Reference casing vibration"),
            "sn_A": _p("sn_A", 1.0e17, "MPa^m·cycles", "assumption", "Basquin coefficient for LCF start-stop cycles"),
            "sn_m": _p("sn_m", 5.0, "-", "assumption", "Basquin exponent"),
            "endurance_limit_mpa": _p("endurance_limit_mpa", 80.0, "MPa", "assumption", "Endurance limit"),
        }

    def default_state(self):
        return {"creep_strain": 0.0, "thermal_fatigue_damage": 0.0, "miner_damage": 0.0, "oxide_thickness_m": 0.0, "hot_hours": 0.0, "flights": 0.0, "cumulative_cycles": 0.0}

    def validate_parameters(self, params):
        errs: list[str] = []
        require_positive(params, ["creep_A", "creep_n", "creep_Q", "creep_strain_limit", "cte_alpha", "fatigue_ductility_coeff", "centrifugal_stress_ref_mpa", "metal_temperature_ref_k"], errs)
        if params.get("fatigue_ductility_exp", 0) >= 0:
            errs.append("fatigue_ductility_exp must be negative")
        if not (0 <= params.get("constraint_factor", 0) <= 1):
            errs.append("constraint_factor must be in [0,1]")
        return errs

    def step(self, state, params, loading: FlightLoading) -> StepResult:
        eps0 = state.get("creep_strain", 0.0)
        exposure = loading.channels.get("phase_exposure", [])
        if not exposure:
            raise EngineError("Turbine-blade step requires phase (σ, T) exposure data.")
        d_eps = 0.0
        hot_s = 0.0
        ox = state.get("oxide_thickness_m", 0.0)
        for ph in exposure:
            d_eps += cr.creep_strain_increment(ph["sigma_mpa"], ph["T_k"], ph["duration_s"], params["creep_A"], params["creep_n"], params["creep_Q"])
            ox = su.parabolic_oxide_growth(ox, ph["T_k"], ph["duration_s"], params["oxidation_k0"], params["oxidation_Q"])
            if ph["T_k"] >= 0.85 * params["metal_temperature_ref_k"]:
                hot_s += ph["duration_s"]
        eps1 = eps0 + d_eps
        # thermal fatigue: major cycle + throttle transients at 25 % ΔT
        tf_major = tf.thermal_cycle_damage(loading.thermal_cycles, loading.delta_temperature_k, params["cte_alpha"], params["constraint_factor"], params["fatigue_ductility_coeff"], params["fatigue_ductility_exp"])
        n_trans = loading.channels.get("throttle_transients", 0.0)
        tf_trans = tf.thermal_cycle_damage(n_trans, 0.25 * loading.delta_temperature_k, params["cte_alpha"], params["constraint_factor"], params["fatigue_ductility_coeff"], params["fatigue_ductility_exp"])
        dTF = tf_major["damage"] + tf_trans["damage"]
        TF1 = state.get("thermal_fatigue_damage", 0.0) + dTF
        dD, sn_breakdown = fa.miner_damage(loading.stress_bins, params["sn_A"], params["sn_m"], params.get("endurance_limit_mpa", 0.0))
        D1 = state.get("miner_damage", 0.0) + dD
        status, detail = "within_threshold", f"creep ε = {eps1*100:.4f} % (< {params['creep_strain_limit']*100:.1f} %), TF damage {TF1:.4f}"
        if eps1 >= params["creep_strain_limit"]:
            status, detail = "threshold_crossed", "Creep strain reached the configured review limit."
        elif TF1 >= 1.0:
            status, detail = "threshold_crossed", "Thermal-fatigue damage reached 1.0."
        elif ox >= params.get("oxide_limit_m", math.inf):
            status, detail = "threshold_crossed", "Oxide thickness exceeded the review limit."
        new_state = {
            "creep_strain": eps1, "thermal_fatigue_damage": TF1, "miner_damage": D1, "oxide_thickness_m": ox,
            "hot_hours": state.get("hot_hours", 0.0) + hot_s / 3600.0,
            "flights": state.get("flights", 0.0) + 1,
            "cumulative_cycles": state.get("cumulative_cycles", 0.0) + sum(b.cycles for b in loading.stress_bins),
        }
        peak_rate = max(cr.creep_strain_rate(ph["sigma_mpa"], ph["T_k"], params["creep_A"], params["creep_n"], params["creep_Q"]) for ph in exposure)
        outputs = {
            "max_stress_mpa": loading.max_stress_mpa, "peak_temperature_k": loading.peak_temperature_k,
            "peak_creep_rate_per_s": peak_rate, "hot_time_s": hot_s,
            "thermal_strain_range": tf_major["strain_range"], "thermal_cycles_to_failure": tf_major["cycles_to_failure"],
            "sn_breakdown": sn_breakdown,
            "margin_creep": 1.0 - eps1 / params["creep_strain_limit"],
            "margin_thermal_fatigue": 1.0 - TF1,
            "margin_oxidation": 1.0 - ox / params["oxide_limit_m"] if params.get("oxide_limit_m") else None,
        }
        return StepResult(new_state, {"creep_strain": d_eps, "thermal_fatigue_damage": dTF, "miner_damage": dD, "oxide_thickness_m": ox - state.get("oxide_thickness_m", 0.0)}, outputs, status, detail)

    def remaining_life(self, state, params, ref: FlightLoading):
        r = self.step(state, params, ref)
        d_eps = r.increments["creep_strain"]
        dTF = r.increments["thermal_fatigue_damage"]
        eps = state.get("creep_strain", 0.0)
        TF = state.get("thermal_fatigue_damage", 0.0)
        creep_fl = (params["creep_strain_limit"] - eps) / d_eps if d_eps > 0 else None
        tf_fl = (1 - TF) / dTF if dTF > 0 else None
        cands = {k: v for k, v in (("creep", creep_fl), ("thermal_fatigue", tf_fl)) if v is not None}
        return {
            "unit": "flights of the reference mission",
            "creep_remaining_flights": creep_fl, "creep_strain_per_flight": d_eps,
            "thermal_fatigue_remaining_flights": tf_fl, "thermal_fatigue_damage_per_flight": dTF,
            "creep_remaining_hot_hours": _finite(cr.time_to_strain_limit(params["centrifugal_stress_ref_mpa"], params["metal_temperature_ref_k"], eps, params["creep_strain_limit"], params["creep_A"], params["creep_n"], params["creep_Q"])),
            "governing_remaining_flights": min(cands.values()) if cands else None,
            "governing_mechanism": min(cands, key=cands.get) if cands else None,
        }

    def equations(self):
        return [
            {"name": "Norton creep", "latex": "\\dot{\\varepsilon} = A\\sigma^n \\exp(-Q/RT)", "text": "ε̇ = A·σⁿ·exp(−Q/RT)"},
            {"name": "Thermal strain", "latex": "\\Delta\\varepsilon = k_c \\alpha \\Delta T", "text": "Δε = k_c·α·ΔT"},
            {"name": "Coffin–Manson", "latex": "\\Delta\\varepsilon/2 = \\varepsilon_f' (2N_f)^c", "text": "Δε/2 = ε_f'·(2N_f)^c"},
            {"name": "Parabolic oxidation", "latex": "x^2 = k_p t,\\; k_p = k_0 e^{-Q_{ox}/RT}", "text": "x² = k_p·t"},
        ]

    def relevant_mission_inputs(self):
        return ["duration_min", "temperature_c", "operating_intensity", "manoeuvre_intensity", "load_factor", "load_variation", "vibration_level"]

    def uncertain_parameters(self):
        return {
            "creep_A": {"dist": "lognormal", "cov": 0.5, "class": "parameter"},
            "thermal_response_factor": {"dist": "normal", "cov": 0.03, "class": "operational", "response": True},
            "constraint_factor": {"dist": "normal", "cov": 0.15, "class": "model_form"},
        }


# ===================================================================== MODEL 4
class HydraulicActuatorModel(DegradationModel):
    model_type = "hydraulic_actuator"
    display_name = "Hydraulic actuator — seal wear and internal leakage surrogate"
    mechanisms = ["seal_wear", "internal_leakage", "pressure_degradation", "temperature_deterioration"]

    def default_parameters(self):
        return {
            "nominal_pressure_mpa": _p("nominal_pressure_mpa", 20.7, "MPa", "input", "System pressure (3000 psi class)"),
            "rated_force_kN": _p("rated_force_kN", 60.0, "kN", "input", "Rated actuator force"),
            "wear_k": _p("wear_k", 2.2e-6, "1/cycle", "assumption", "Seal wear coefficient per pressure cycle at reference conditions"),
            "wear_alpha": _p("wear_alpha", 1.8, "-", "assumption", "Pressure exponent"),
            "wear_beta": _p("wear_beta", 0.012, "1/K", "assumption", "Temperature sensitivity"),
            "wear_gamma": _p("wear_gamma", 0.8, "-", "assumption", "Wear acceleration with existing wear"),
            "T_ref_k": _p("T_ref_k", 323.15, "K", "assumption", "Reference fluid temperature (50 °C)"),
            "leak_Q0_lpm": _p("leak_Q0_lpm", 0.02, "L/min", "assumption", "Baseline internal leakage of a new seal"),
            "leak_kq_lpm": _p("leak_kq_lpm", 0.6, "L/min", "assumption", "Leakage increase at W = 1"),
            "leak_limit_lpm": _p("leak_limit_lpm", 0.5, "L/min", "assumption", "Internal leakage limit for engineering review"),
            "fluid_temperature_rise_k": _p("fluid_temperature_rise_k", 45.0, "K", "assumption", "Fluid temperature rise above ambient at full duty"),
            "vibration_ref_g": _p("vibration_ref_g", 1.0, "g RMS", "assumption", "Reference vibration"),
        }

    def default_state(self):
        return {"wear_indicator": 0.0, "cumulative_cycles": 0.0, "flights": 0.0, "operating_hours": 0.0}

    def validate_parameters(self, params):
        errs: list[str] = []
        require_positive(params, ["nominal_pressure_mpa", "wear_alpha", "T_ref_k", "leak_limit_lpm"], errs)
        if params.get("wear_k", -1) < 0:
            errs.append("wear_k must be non-negative")
        return errs

    def step(self, state, params, loading: FlightLoading) -> StepResult:
        W0 = state.get("wear_indicator", 0.0)
        dW = su.seal_wear_increment(W0, loading.pressure_cycles, loading.pressure_mpa, loading.mean_temperature_k, params["wear_k"], params["nominal_pressure_mpa"], params["wear_alpha"], params["wear_beta"], params["T_ref_k"], params["wear_gamma"])
        W1 = W0 + dW
        leak = su.leakage_from_wear(W1, params["leak_Q0_lpm"], params["leak_kq_lpm"])
        # pressure-performance deviation: fraction of pressure capability lost ∝ leakage
        p_dev = min(1.0, leak / (5.0 * params["leak_limit_lpm"]))
        status, detail = "within_threshold", f"W = {W1:.4f}, leakage {leak:.3f} L/min (< {params['leak_limit_lpm']} L/min)"
        if leak >= params["leak_limit_lpm"]:
            status, detail = "threshold_crossed", "Modelled internal leakage reached the review limit."
        new_state = {
            "wear_indicator": W1, "cumulative_cycles": state.get("cumulative_cycles", 0.0) + loading.pressure_cycles,
            "flights": state.get("flights", 0.0) + 1, "operating_hours": state.get("operating_hours", 0.0) + loading.duration_s / 3600.0,
        }
        outputs = {
            "pressure_cycles": loading.pressure_cycles, "mean_pressure_mpa": loading.pressure_mpa, "mean_temperature_k": loading.mean_temperature_k,
            "leakage_lpm": leak, "pressure_performance_deviation": p_dev,
            "margin_leakage": 1.0 - leak / params["leak_limit_lpm"],
            "peak_temperature_k": loading.peak_temperature_k,
        }
        return StepResult(new_state, {"wear_indicator": dW, "leakage_lpm": leak}, outputs, status, detail)

    def remaining_life(self, state, params, ref: FlightLoading):
        W = state.get("wear_indicator", 0.0)
        W_limit = (params["leak_limit_lpm"] - params["leak_Q0_lpm"]) / params["leak_kq_lpm"]
        # iterate because wear accelerates with W
        flights, W_run, cycles = 0, W, 0.0
        while W_run < W_limit and flights < 50000:
            dW = su.seal_wear_increment(W_run, ref.pressure_cycles, ref.pressure_mpa, ref.mean_temperature_k, params["wear_k"], params["nominal_pressure_mpa"], params["wear_alpha"], params["wear_beta"], params["T_ref_k"], params["wear_gamma"])
            if dW <= 0:
                break
            W_run += dW; flights += 1; cycles += ref.pressure_cycles
        reached = W_run >= W_limit
        return {
            "unit": "flights of the reference mission",
            "wear_limit": W_limit,
            "governing_remaining_flights": flights if reached else None,
            "remaining_pressure_cycles": cycles if reached else None,
            "governing_mechanism": "seal_wear_leakage" if reached else None,
            "note": None if reached else "Leakage limit not reached within 50000 flights or zero wear rate",
        }

    def equations(self):
        return [
            {"name": "Seal wear surrogate", "latex": "\\Delta W = k_w n_p (p/p_{ref})^{\\alpha} e^{\\beta (T-T_{ref})} (1+\\gamma W)", "text": "ΔW = k_w·n_p·(p/p_ref)^α·exp(β(T−T_ref))·(1+γW)"},
            {"name": "Leakage", "latex": "Q = Q_0 + k_q W", "text": "Q = Q₀ + k_q·W"},
        ]

    def relevant_mission_inputs(self):
        return ["duration_min", "pressure_factor", "temperature_c", "manoeuvre_intensity", "operating_intensity", "load_factor"]

    def uncertain_parameters(self):
        return {
            "wear_k": {"dist": "lognormal", "cov": 0.4, "class": "parameter"},
            "pressure_response_factor": {"dist": "normal", "cov": 0.04, "class": "operational", "response": True},
            "wear_indicator": {"dist": "normal", "sd_abs": 0.03, "class": "measurement", "state": True},
        }
