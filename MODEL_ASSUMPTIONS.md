# AeroSim — Model Assumptions

Every number below is an **illustrative demonstration value** (provenance `assumption` unless stated) chosen to be of the order reported in open engineering literature for the stated material class. None is a certified allowable. All values are editable per component in the UI and are stored with provenance tags.

## 1. Phase time fractions (all missions)

taxi 0.08 · take-off 0.02 · climb 0.15 · cruise 0.50 · manoeuvring 0.10 · descent 0.10 · landing 0.05 (must sum to 1 ± 0.02).

## 2. Phase tables — fraction of (reference load, thermal severity, vibration, pressure)

| Phase | Engine mount | Landing gear | Turbine blade (load = N/N_ref) | Hydraulic actuator |
|---|---|---|---|---|
| taxi | 0.15 / 0.20 / 0.40 / 1.0 | 0.45 / 0.10 / 0.60 / 1.0 | 0.30 / 0.60 / 0.40 / 0.35 | 0.40 / 0.50 / 0.40 / 1.0 |
| take-off | 1.00 / 1.00 / 1.00 / 1.0 | 0.70 / 0.15 / 0.80 / 1.0 | 1.00 / 1.00 / 1.00 / 1.00 | 0.80 / 0.70 / 1.00 / 1.0 |
| climb | 0.85 / 0.90 / 0.85 / 1.0 | 0 / 0.05 / 0.05 / 1.0 | 0.92 / 0.96 / 0.90 / 0.92 | 0.60 / 0.85 / 0.70 / 1.0 |
| cruise | 0.60 / 0.70 / 0.60 / 1.0 | 0 / 0 / 0.02 / 1.0 | 0.75 / 0.88 / 0.70 / 0.80 | 0.35 / 1.00 / 0.40 / 1.0 |
| manoeuvring | 0.75 / 0.75 / 0.80 / 1.0 | 0 / 0 / 0.05 / 1.0 | 0.85 / 0.93 / 0.85 / 0.88 | 1.00 / 0.95 / 0.90 / 1.0 |
| descent | 0.30 / 0.45 / 0.50 / 1.0 | 0 / 0 / 0.05 / 1.0 | 0.40 / 0.70 / 0.50 / 0.50 | 0.50 / 0.80 / 0.60 / 1.0 |
| landing | 0.45 / 0.40 / 0.70 / 1.0 | 1.00 / 0.30 / 1.00 / 1.0 | 0.35 / 0.62 / 0.45 / 0.40 | 0.85 / 0.65 / 0.95 / 1.0 |

Actuation (pressure-cycle) rates per hour of phase for the actuator: taxi 120, take-off 450, climb 180, cruise 60, manoeuvring 720 (× manoeuvre intensity), descent 240, landing 540.

Environment factors (corrosion): benign 1.0, humid 1.6, marine 2.5, desert 1.3.

## 3. Mission presets

| Preset | Overrides |
|---|---|
| Normal operation | defaults (120 min, 1 landing, load 1.0, variation 0.10, manoeuvre 1.0, 15 °C, pressure 1.0, vibration 1.0, benign, intensity 1.0) |
| Increased-load | load 1.25, variation 0.15, intensity 1.15 |
| High-temperature | 45 °C, intensity 1.10 |
| High-manoeuvre-load | manoeuvre 2.5, load 1.15, variation 0.25, vibration 1.3 |
| Adverse-environment | marine, 32 °C, vibration 1.2, variation 0.2 |

## 4. Demonstration fleet and component instances

Aircraft AIRCRAFT-001 (registration DEMO-001, twin-engine narrow-body demonstration type). History window starts 2026-08-01. Routes: DEMO-A → DEMO-B (120 min, benign, manoeuvre μ 1.0, intensity μ 1.00, 18 °C), DEMO-B → DEMO-C (95 min, marine, 1.4, 1.08, 27 °C), DEMO-C → DEMO-A (150 min, humid, 0.8, 0.97, 24 °C). Planned load factor from payload: f_load = 0.85 + 0.20·payload_fraction (documented relation). Actual conditions = scheduled × deterministic perturbations (duration N(1, 0.04), load N(1, 0.03), temperature ± N(0, 2 °C), manoeuvre N(μ, 0.15), vibration N(1, 0.08), intensity N(μ, 0.04), variation U(0.08, 0.16)).

| Instance | Type · position · P/N · S/N · installed | Baseline at 2026-08-01 (provenance) | History events |
|---|---|---|---|
| ENG-MOUNT-001 | engine_mount · LH · DM-EM-4410 · SN-EM-0187 · 2024-03-10 | D 0.36 (inferred from 1700 flights of usage records), a 0 (FPI 2026-05-02 negative) | UT 2026-08-20 (crack found, σ 0.3 mm), disposition 2026-08-21 (repair deferred), UT 2026-10-15 (σ 0.2 mm) |
| ENG-MOUNT-002 | engine_mount · RH · DM-EM-4410 · SN-EM-0192 · 2024-03-10 | D 0.33 (inferred), a 0 | FPI 2026-08-20 (no indication) |
| LAND-GEAR-001 | landing_gear · LH · DL-MLG-2200 · SN-LG-0451 · 2023-11-18 | D 0.21 (inferred from 2210 landings), pit 120 µm (EC survey 2026-07-12) | EC 2026-09-25 (σ 10 µm) |
| LAND-GEAR-002 | landing_gear · RH · DL-MLG-2200 · SN-LG-0452 · 2023-11-18 | D 0.22, pit 90 µm | EC 2026-09-25 |
| TURB-BLADE-001 | turbine_blade · engine 1 · DT-HPT1-017 · SN-TB-8821 · 2025-01-22 | ε 0.42 % (inferred from 2400 hot hours), TF 0.31, oxide 12 µm (borescope 2026-07-03) | borescope 2026-09-10 (qualitative, low confidence) |
| HYD-ACT-001 | hydraulic_actuator · LH outboard aileron · DH-ACT-3000 · SN-HA-1140 · 2025-06-15 | W 0.35 (bench leakage test 2026-06-15) | leakage test 2026-09-20, seal replacement 2026-09-20 (W → 0.02), leakage test 2026-10-20 |

Seven further instances (FAN-BLADE-001, WING-SPAR-001, ELEV-LINK-001, FUEL-PUMP-002, IDG-BRG-001, ACM-TURB-001, ROTOR-BLADE-001) are registered without a quantitative model. Twelve completed flights (2026-08-03 … 2026-10-28) and three scheduled flights (2026-11-05, 11-08, 11-12).

Model parameter defaults per type (illustrative) are unchanged from the physics engine: engine mount sn_A 5.0e13, sn_m 4.0, endurance 35 MPa, paris_C 1.0e-11, paris_m 3.0, ΔK_th 3.0, K_IC 75, Y 1.12, E 114 GPa, F_ref 132 kN, A_eff 600 mm², f_vib 25 Hz, Δσ_vib,ref 25 MPa, ΔT_zone 60 K, R 0.1; landing gear sn_A 6.0e15, sn_m 4.2, endurance 120 MPa, paris_C 6.0e-12, paris_m 3.0, ΔK_th 5.0, K_IC 55, Y 1.0, E 205 GPa, F_ref 420 kN, A_eff 900 mm², r₀ 1.2e-12 m/s, pit limit 500 µm, 6 h ground exposure per landing; turbine blade creep_A 4.3e-8, n 5.0, Q 300 kJ/mol, strain limit 1 %, α 1.4e-5 /K, k_c 0.35, ε_f' 0.25, c −0.6, k₀ 2.0e-6 m²/s, Q_ox 250 kJ/mol, oxide limit 30 µm, σ_c,ref 260 MPa, T_metal,ref 1160 K; actuator p_nom 20.7 MPa, k_w 2.2e-6, α 1.8, β 0.012 /K, γ 0.8, T_ref 323.15 K, Q₀ 0.02 L/min, k_q 0.6 L/min, limit 0.5 L/min.

## 5. Hidden reference (ground-truth) configurations — revealed for validation only

| Instance (seed) | True k_L / k_T / k_V / k_P | Coefficient overrides | True state at history start | Sensor noise σ | Bias |
|---|---|---|---|---|---|
| ENG-MOUNT-001 (42) | 1.12 / 1.05 / 0.92 / 1.00 | paris_C 1.35e-11, sn_A 4.2e13 | D 0.39, a 5.75 mm | load 2.5 kN, strain 25 µε, T 1.2 °C, vib 0.04 g | T +1.5 °C |
| ENG-MOUNT-002 (52) | 0.97 / 1.02 / 1.06 / 1.00 | paris_C 1.1e-11, sn_A 4.8e13 | D 0.34, a 0 | same | — |
| LAND-GEAR-001 (43) | 0.94 / 1.10 / 1.15 / 1.00 | r₀ 1.8e-12 | D 0.23, pit 140 µm | 6 kN, 30 µε, 1.0 °C, 0.12 g | — |
| LAND-GEAR-002 (53) | 1.05 / 1.00 / 0.95 / 1.00 | r₀ 1.0e-12 | D 0.225, pit 100 µm | same | load −3 kN |
| TURB-BLADE-001 (44) | 1.03 / 1.04 / 1.00 / 0.97 | creep_A 5.5e-8 | ε 0.47 %, TF 0.33, oxide 13 µm | T 4 °C, 1.5 kN, 0.4 bar, 0.15 g | T −3 °C |
| HYD-ACT-001 (45) | 1.00 / 1.15 / 1.00 / 1.04 | k_w 2.8e-6 | W 0.39 (→ 0.02 after seal replacement) | 3 bar, 1.5 °C, 1 kN, 0.05 g | p +2 bar |

## 6. Learning constants

RLS forgetting factor 0.98 (settable); initial covariance P₀ = 1; reduced-confidence blend 0.5; maximum relative change per Stage-A update 0.40; uncertainty inflation ×1.1 per unattributed discrepancy; condition-resolution thresholds: same route ≥ 2 comparable flights, any route ≥ 3, engineering default σ (duration 10 min, load 0.08, variation 0.04, manoeuvre 0.3, temperature 5 °C, pressure 0.04, vibration 0.15, intensity 0.06); reliability thresholds as in METHODOLOGY §7; model-state σ_base: crack 0.25 mm, pit 20 µm, wear 0.03, oxide 2 µm, creep strain 5e-4; growth per flight g: crack 5 µm, pit 0.05 µm, wear 2e-4, oxide 0.01 µm, creep 2e-6; plus 3 % of the state value; identifiability factor 3; coefficient damping exponent 0.5; bounds ×0.5…×2.

## 7. Uncertainty distributions

ENG-MOUNT-001 / -002: sn_A log-normal CoV 0.35 (parameter); paris_C log-normal CoV 0.30 (parameter); crack length normal σ 0.25 mm (measurement); k_L normal CoV 0.06 (operational); Y normal CoV 0.04 (model form).
LAND-GEAR-001 / -002: sn_A CoV 0.40; k_L CoV 0.08; r₀ CoV 0.5.
TURB-BLADE-001: creep_A CoV 0.5; k_T CoV 0.03; k_c CoV 0.15 (model form).
HYD-ACT-001: k_w CoV 0.4; k_P CoV 0.04; W σ 0.03 (measurement).
Sample cap: samples × flights ≤ 60 000. Intervals are sample percentiles, not calibrated.

## 8. Review criteria used for the "engineering review" status

Threshold crossed, or minimum margin < 25 %, or governing remaining life < 100 flights of the reference mission. These are prototype display thresholds, not maintenance criteria.
