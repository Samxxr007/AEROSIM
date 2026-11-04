"""
Demonstration fleet: one aircraft, individual component instances (each with
its own baseline, history and hidden reference model), failure catalogue and
application settings.

Everything here is SYNTHETIC DEMONSTRATION DATA. The synthetic flight history
(flights, observations, inspections, maintenance) is generated from the hidden
reference models by services/history.py in a chronologically consistent way.
"""
from __future__ import annotations

from typing import Any

from ..db import Database, now_iso
from ..engine.registry import DEFAULT_RESPONSE_PARAMS, MODEL_REGISTRY

SYSTEM_CATEGORIES = [
    "Propulsion",
    "Engine mounting and support",
    "Landing gear",
    "Airframe and structures",
    "Flight controls",
    "Hydraulic systems",
    "Fuel systems",
    "Electrical systems",
    "Environmental control",
    "Helicopter systems",
]

FAILURE_CATALOGUE: dict[str, list[str]] = {
    "Engine and propulsion": [
        "Fan-blade erosion", "Compressor-blade damage", "Turbine creep", "Bearing spalling", "Shaft fatigue",
        "Gearbox pitting", "Combustion-chamber thermal degradation", "Oil contamination", "Engine attachment fatigue",
    ],
    "Landing gear": [
        "Shock-absorber seal degradation", "Wheel-bearing wear", "Brake-disc wear", "Axle fatigue", "Retraction-mechanism wear", "Tyre deterioration",
    ],
    "Engine mounting": [
        "Mount fatigue", "Pylon cracking", "Bolt loosening", "Bracket deformation", "Vibration-isolator stiffness degradation",
    ],
    "Flight controls": [
        "Actuator leakage", "Hinge wear", "Linkage fatigue", "Servo-valve degradation", "Flap mechanism wear", "Rudder and elevator actuator degradation",
    ],
    "Hydraulic and pneumatic": [
        "Pump wear", "Cavitation", "Filter blockage", "Pipe leakage", "Accumulator pressure loss", "Seal degradation", "Valve malfunction",
    ],
    "Fuel systems": ["Pump deterioration", "Filter blockage", "Pipe corrosion", "Valve leakage", "Fuel contamination"],
    "Electrical and avionics": [
        "Insulation deterioration", "Wiring damage", "Connector corrosion", "Generator bearing wear", "Power converter degradation",
        "Battery capacity deterioration", "Electronic thermal ageing",
    ],
    "Airframe": [
        "Wing-spar fatigue", "Wing-rib buckling", "Fuselage-frame fatigue", "Bulkhead fatigue", "Skin-panel corrosion", "Composite delamination", "Tail-structure fatigue",
    ],
    "Helicopters": [
        "Rotor-blade fatigue", "Rotor-hub wear", "Pitch-link degradation", "Gearbox wear", "Transmission-shaft fatigue", "Rotor-bearing degradation",
    ],
}

IMPLEMENTED_MECHANISMS = {
    "Mount fatigue": "engine_mount", "Pylon cracking": "engine_mount", "Engine attachment fatigue": "engine_mount",
    "Axle fatigue": "landing_gear", "Turbine creep": "turbine_blade", "Actuator leakage": "hydraulic_actuator", "Seal degradation": "hydraulic_actuator",
}

AIRCRAFT_ID = "AIRCRAFT-001"
HISTORY_START = "2026-08-01"


def _params(model_type: str, overrides: dict[str, float] | None = None) -> dict[str, dict[str, Any]]:
    model = MODEL_REGISTRY[model_type]
    out = {k: p.to_dict() for k, p in model.default_parameters().items()}
    for k, v in (overrides or {}).items():
        out[k]["value"] = v
    return out


def demo_aircraft() -> dict[str, Any]:
    return {
        "id": AIRCRAFT_ID,
        "aircraft_type": "Twin-engine narrow-body transport (demonstration type)",
        "registration_or_demo_id": "DEMO-001",
        "configuration": {"engines": 2, "main_gear_legs": 2, "hydraulic_systems": 3, "notes": "Synthetic demonstration aircraft; no real registration."},
        "provenance": "synthetic_demo",
    }


def _instance(cid: str, name: str, system: str, position: str, model_type: str, manufacturer: str, pn: str, sn: str, installed: str, description: str, material: str, geometry: dict, params: dict, baseline: dict, baseline_prov: dict, initial_condition: str, mechanisms: list[str], tags: list[str]) -> dict[str, Any]:
    ts = now_iso()
    return {
        "id": cid, "aircraft_id": AIRCRAFT_ID, "name": name, "system": system, "position": position,
        "component_type": model_type, "model_type": model_type, "manufacturer": manufacturer, "part_number": pn, "serial_number": sn, "installation_date": installed,
        "description": description, "material": material, "geometry": geometry, "parameters": params,
        "baseline_state": dict(baseline), "baseline_provenance": baseline_prov, "baseline_date": HISTORY_START, "state": dict(baseline),
        "initial_condition": initial_condition, "degradation_mechanisms": mechanisms, "tags": tags,
        "provenance": "synthetic_demo", "model_version": 1, "response_params": dict(DEFAULT_RESPONSE_PARAMS), "history_initialised": False,
        "created_at": f"{HISTORY_START}T08:00:00+00:00", "updated_at": ts,
    }


def demo_components() -> list[dict[str, Any]]:
    """Individual component instances. `baseline_state` is the twin's documented starting estimate at HISTORY_START."""
    lug_geo = {"type": "lug / edge crack", "net_section_mm2": 600, "thickness_mm": 18, "lug_width_mm": 52, "hole_diameter_mm": 20}
    gear_geo = {"type": "cylinder fillet", "net_section_mm2": 900, "outer_diameter_mm": 150, "wall_mm": 12}
    comps = [
        _instance("ENG-MOUNT-001", "Left engine mount — forward pylon lug", "Engine mounting and support", "LH", "engine_mount", "Demo Aerostructures", "DM-EM-4410", "SN-EM-0187", "2024-03-10",
                  "Forward engine-mount lug transferring thrust and vertical engine loads into the pylon box. A 5.8 mm edge crack was found by ultrasonic inspection on 2026-08-20 and is monitored under repair deferral.",
                  "Ti-6Al-4V (illustrative material class)", lug_geo, _params("engine_mount", {"initial_crack_m": 0.0}),
                  {"miner_damage": 0.36, "crack_length_m": 0.0, "cumulative_cycles": 2.2e6, "flights": 1700, "pit_depth_m": 0.0},
                  {"miner_damage": "inferred from 1700 flights of operator usage records (synthetic) through the S-N model", "crack_length_m": "no detected crack at history start (FPI 2026-05-02 negative)", "flights": "operator records", "cumulative_cycles": "inferred from flights × reference spectrum"},
                  "At history start (2026-08-01): D = 0.36 inferred from 1700 flights of usage records; no detected crack (FPI 2026-05-02 negative).",
                  ["Fatigue accumulation (S-N / Miner)", "Fatigue crack propagation (Paris)", "Corrosion (optional, disabled)"], ["flagship-demo", "structural"]),
        _instance("ENG-MOUNT-002", "Right engine mount — forward pylon lug", "Engine mounting and support", "RH", "engine_mount", "Demo Aerostructures", "DM-EM-4410", "SN-EM-0192", "2024-03-10",
                  "Right-hand forward engine-mount lug, same part number as ENG-MOUNT-001 but a separate physical instance with its own history. No detected crack.",
                  "Ti-6Al-4V (illustrative material class)", lug_geo, _params("engine_mount", {"initial_crack_m": 0.0}),
                  {"miner_damage": 0.33, "crack_length_m": 0.0, "cumulative_cycles": 2.2e6, "flights": 1700, "pit_depth_m": 0.0},
                  {"miner_damage": "inferred from usage records (synthetic)", "crack_length_m": "no detected crack (FPI 2026-05-02 negative)"},
                  "At history start: D = 0.33 inferred; no detected crack.",
                  ["Fatigue accumulation (S-N / Miner)", "Fatigue crack propagation (if a crack is detected)"], ["structural"]),
        _instance("LAND-GEAR-001", "Left main landing gear — outer cylinder lower fillet", "Landing gear", "LH", "landing_gear", "Demo Landing Systems", "DL-MLG-2200", "SN-LG-0451", "2023-11-18",
                  "Outer cylinder of the left main landing gear at the lower bearing fillet; subjected to touchdown, taxi and braking loads plus environmental exposure.",
                  "300M high-strength steel (illustrative material class)", gear_geo, _params("landing_gear"),
                  {"miner_damage": 0.21, "crack_length_m": 0.0, "cumulative_cycles": 9.1e5, "flights": 2210, "pit_depth_m": 0.00012, "landings": 2210},
                  {"miner_damage": "inferred from 2210 landings (synthetic records)", "pit_depth_m": "eddy-current survey 2026-07-12 (120 µm)"},
                  "At history start: D = 0.21 from 2210 landings; pitting 120 µm (EC survey 2026-07-12); no crack.",
                  ["Fatigue accumulation", "Fatigue crack propagation (if detected)", "Corrosion pitting (surrogate)", "Mechanical wear (catalogue)"], ["structural"]),
        _instance("LAND-GEAR-002", "Right main landing gear — outer cylinder lower fillet", "Landing gear", "RH", "landing_gear", "Demo Landing Systems", "DL-MLG-2200", "SN-LG-0452", "2023-11-18",
                  "Right main landing gear outer cylinder; separate instance from LAND-GEAR-001 with its own landing history and corrosion survey.",
                  "300M high-strength steel (illustrative material class)", gear_geo, _params("landing_gear"),
                  {"miner_damage": 0.22, "crack_length_m": 0.0, "cumulative_cycles": 9.1e5, "flights": 2210, "pit_depth_m": 0.00009, "landings": 2210},
                  {"miner_damage": "inferred from 2210 landings", "pit_depth_m": "eddy-current survey 2026-07-12 (90 µm)"},
                  "At history start: D = 0.22; pitting 90 µm; no crack.", ["Fatigue accumulation", "Corrosion pitting (surrogate)"], ["structural"]),
        _instance("TURB-BLADE-001", "HP turbine blade — stage 1, blade 17 (engine 1)", "Propulsion", "Engine 1", "turbine_blade", "Demo Turbines", "DT-HPT1-017", "SN-TB-8821", "2025-01-22",
                  "First-stage HP turbine blade subject to creep at the root/airfoil transition, thermal fatigue at the leading edge and surface oxidation.",
                  "Ni-base single-crystal superalloy (illustrative material class)", {"type": "cooled airfoil", "root_area_mm2": 400, "span_mm": 62, "wall_mm": 1.2}, _params("turbine_blade"),
                  {"creep_strain": 0.0042, "thermal_fatigue_damage": 0.31, "miner_damage": 0.02, "oxide_thickness_m": 1.2e-5, "hot_hours": 2400, "flights": 1300, "cumulative_cycles": 9000},
                  {"creep_strain": "inferred from 2400 hot hours at recorded EGT (synthetic)", "oxide_thickness_m": "borescope 2026-07-03 (12 µm, qualitative)"},
                  "At history start: creep strain 0.42 % (inferred), TF damage 0.31, oxide 12 µm (borescope 2026-07-03).",
                  ["Creep (Norton)", "Thermal fatigue (Coffin–Manson surrogate)", "Oxidation (parabolic, optional)"], ["thermal"]),
        _instance("HYD-ACT-001", "Aileron hydraulic actuator — LH outboard", "Hydraulic systems", "LH outboard aileron", "hydraulic_actuator", "Demo Hydraulics", "DH-ACT-3000", "SN-HA-1140", "2025-06-15",
                  "Linear hydraulic servo-actuator for the left outboard aileron, 3000 psi system; degradation dominated by piston-seal wear leading to internal leakage. Seals were replaced on 2026-09-20.",
                  "Steel body / PTFE-elastomer seal (illustrative)", {"type": "linear actuator", "bore_mm": 50, "stroke_mm": 80}, _params("hydraulic_actuator"),
                  {"wear_indicator": 0.35, "cumulative_cycles": 180000, "flights": 980, "operating_hours": 2100},
                  {"wear_indicator": "bench leakage test 2026-06-15 (0.23 L/min → W 0.35 through the leakage relation)"},
                  "At history start: W = 0.35 from bench leakage test 2026-06-15.",
                  ["Seal wear", "Internal leakage", "Pressure degradation", "Temperature deterioration"], ["hydraulic"]),
    ]
    catalogue_only = [
        ("FAN-BLADE-001", "Fan blade — stage 1, blade 4 (engine 1)", "Propulsion", "Ti-6Al-4V", ["Fan-blade erosion", "Foreign-object damage"]),
        ("WING-SPAR-001", "Wing spar — front spar lower cap, rib 12 (LH)", "Airframe and structures", "Al 7075-T6", ["Wing-spar fatigue", "Skin-panel corrosion"]),
        ("ELEV-LINK-001", "Elevator actuator linkage", "Flight controls", "15-5PH steel", ["Linkage fatigue", "Hinge wear"]),
        ("FUEL-PUMP-002", "Fuel boost pump — tank 2", "Fuel systems", "Al casting / steel impeller", ["Pump deterioration", "Fuel contamination"]),
        ("IDG-BRG-001", "Integrated drive generator — bearing set (engine 1)", "Electrical systems", "Bearing steel", ["Generator bearing wear", "Insulation deterioration"]),
        ("ACM-TURB-001", "Air-cycle machine turbine", "Environmental control", "Al alloy", ["Bearing spalling", "Electronic thermal ageing"]),
        ("ROTOR-BLADE-001", "Main rotor blade — root attachment (helicopter demo entry)", "Helicopter systems", "CFRP / Ti fitting", ["Rotor-blade fatigue", "Pitch-link degradation"]),
    ]
    for cid, name, system, material, mechs in catalogue_only:
        c = _instance(cid, name, system, "", "engine_mount", "Demo", "n/a", "n/a", "2024-01-01",
                      f"Registered component instance. Degradation mechanisms {', '.join(mechs)} are catalogued; no quantitative prediction model is implemented for this component type in the current prototype.",
                      material + " (illustrative)", {}, {}, {}, {}, "Not assessed — catalogue entry only.", mechs, ["catalogue-only"])
        c["component_type"] = None
        c["model_type"] = None
        comps.append(c)
    return comps


def hidden_reference_models() -> list[dict[str, Any]]:
    """Hidden reference configurations used ONLY to generate synthetic observations and inspections.

    The digital twin never reads these. `state` is the TRUE state at HISTORY_START. They are revealed on
    the Validation page purely to measure prediction error.
    """
    return [
        {
            "id": "GT-ENG-MOUNT-001", "component_id": "ENG-MOUNT-001", "seed": 42,
            "response_params": {"load_transfer_factor": 1.12, "thermal_response_factor": 1.05, "vibration_response_factor": 0.92, "pressure_response_factor": 1.0},
            "param_overrides": {"paris_C": 1.35e-11, "sn_A": 4.2e13},
            "state": {"miner_damage": 0.39, "crack_length_m": 0.00575, "cumulative_cycles": 2.2e6, "flights": 1700, "pit_depth_m": 0.0},
            "sensor_noise": {"load_kN": 2.5, "strain_microstrain": 25.0, "temperature_c": 1.2, "vibration_g": 0.04},
            "sensor_bias": {"temperature_c": 1.5},
        },
        {
            "id": "GT-ENG-MOUNT-002", "component_id": "ENG-MOUNT-002", "seed": 52,
            "response_params": {"load_transfer_factor": 0.97, "thermal_response_factor": 1.02, "vibration_response_factor": 1.06, "pressure_response_factor": 1.0},
            "param_overrides": {"paris_C": 1.1e-11, "sn_A": 4.8e13},
            "state": {"miner_damage": 0.34, "crack_length_m": 0.0, "cumulative_cycles": 2.2e6, "flights": 1700, "pit_depth_m": 0.0},
            "sensor_noise": {"load_kN": 2.5, "strain_microstrain": 25.0, "temperature_c": 1.2, "vibration_g": 0.04},
            "sensor_bias": {},
        },
        {
            "id": "GT-LAND-GEAR-001", "component_id": "LAND-GEAR-001", "seed": 43,
            "response_params": {"load_transfer_factor": 0.94, "thermal_response_factor": 1.10, "vibration_response_factor": 1.15, "pressure_response_factor": 1.0},
            "param_overrides": {"corrosion_rate_m_per_s": 1.8e-12},
            "state": {"miner_damage": 0.23, "crack_length_m": 0.0, "cumulative_cycles": 9.1e5, "flights": 2210, "pit_depth_m": 0.00014, "landings": 2210},
            "sensor_noise": {"load_kN": 6.0, "strain_microstrain": 30.0, "temperature_c": 1.0, "vibration_g": 0.12},
            "sensor_bias": {},
        },
        {
            "id": "GT-LAND-GEAR-002", "component_id": "LAND-GEAR-002", "seed": 53,
            "response_params": {"load_transfer_factor": 1.05, "thermal_response_factor": 1.0, "vibration_response_factor": 0.95, "pressure_response_factor": 1.0},
            "param_overrides": {"corrosion_rate_m_per_s": 1.0e-12},
            "state": {"miner_damage": 0.225, "crack_length_m": 0.0, "cumulative_cycles": 9.1e5, "flights": 2210, "pit_depth_m": 0.0001, "landings": 2210},
            "sensor_noise": {"load_kN": 6.0, "strain_microstrain": 30.0, "temperature_c": 1.0, "vibration_g": 0.12},
            "sensor_bias": {"load_kN": -3.0},
        },
        {
            "id": "GT-TURB-BLADE-001", "component_id": "TURB-BLADE-001", "seed": 44,
            "response_params": {"load_transfer_factor": 1.03, "thermal_response_factor": 1.04, "vibration_response_factor": 1.0, "pressure_response_factor": 0.97},
            "param_overrides": {"creep_A": 5.5e-8},
            "state": {"creep_strain": 0.0047, "thermal_fatigue_damage": 0.33, "miner_damage": 0.02, "oxide_thickness_m": 1.3e-5, "hot_hours": 2400, "flights": 1300, "cumulative_cycles": 9000},
            "sensor_noise": {"temperature_c": 4.0, "load_kN": 1.5, "pressure_bar": 0.4, "vibration_g": 0.15},
            "sensor_bias": {"temperature_c": -3.0},
        },
        {
            "id": "GT-HYD-ACT-001", "component_id": "HYD-ACT-001", "seed": 45,
            "response_params": {"load_transfer_factor": 1.0, "thermal_response_factor": 1.15, "vibration_response_factor": 1.0, "pressure_response_factor": 1.04},
            "param_overrides": {"wear_k": 2.8e-6},
            "state": {"wear_indicator": 0.39, "cumulative_cycles": 180000, "flights": 980, "operating_hours": 2100},
            "sensor_noise": {"pressure_bar": 3.0, "temperature_c": 1.5, "load_kN": 1.0, "vibration_g": 0.05},
            "sensor_bias": {"pressure_bar": 2.0},
        },
    ]


def default_settings() -> dict[str, Any]:
    return {
        "id": "app",
        "mc_samples": 300,
        "rls_forgetting_factor": 0.98,
        "reduced_confidence_blend": 0.5,
        "max_relative_change_per_update": 0.40,
        "channel_sample_s": 30,
        "demo_seed": 42,
    }


def seed_database(db: Database, reset: bool = False, with_history: bool = True) -> dict[str, int]:
    if reset:
        db.clear_all()
    if db.count("components") == 0:
        db.upsert("aircraft", demo_aircraft())
        for c in demo_components():
            db.upsert("components", c)
        for g in hidden_reference_models():
            db.upsert("ground_truth", g)
        db.upsert("settings", default_settings())
        db.log_activity("seed", "Demonstration fleet loaded: 1 aircraft, 13 component instances (synthetic demo data).")
        if with_history:
            from .history import generate_synthetic_history

            generate_synthetic_history(db)
    return {"components": db.count("components"), "ground_truth": db.count("ground_truth"), "flights": db.count("flights"), "observations": db.count("flight_records")}
