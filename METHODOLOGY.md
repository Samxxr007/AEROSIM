# AeroSim — Methodology

> AeroSim is a research and engineering demonstration prototype. Its outputs are model-based estimates and must not be used as substitutes for approved aircraft maintenance procedures, certified engineering analysis or airworthiness decisions.

## 1. Scope and positioning

AeroSim is a physics-based aerospace engineering platform that maintains individual digital twins for aircraft components using their own historical sensor observations, physical inspection records, maintenance history and engineering specifications. It uses the component's calibrated condition and available upcoming-flight information to predict expected operational response and future degradation; after each completed flight it compares the original prediction with actual observations, corrects its operational model using reliable evidence and updates component damage estimates when validated inspection measurements become available; the updated twin predicts the next flight. None of the individual ideas — component digital twins, physics-based degradation models, prediction-versus-actual learning — is claimed as new (e.g. Glaessgen & Stargel, 2012). The proposed technical contribution is the controlled two-stage update method, separating operational-response correction from inspection-confirmed damage-state correction under an evidence gate, which requires comparative experimental validation (§9). Hypothetical scenario simulation is retained only as a clearly labelled secondary what-if tool.

## 1a. Primary data flow and leakage control

1. **Historical ingestion** per component instance: flight observations keyed by flight ID (measured channels may be missing per installation; unavailable channels are listed), inspection records, maintenance records, engineering specification and a documented baseline condition with per-variable provenance (`inferred`, `measured`, `specification`).
2. **Twin initialisation** = chronological replay of the component's own history. The twin is reset to its baseline and, event by event: for each completed flight a pre-flight prediction is made using only the twin state and information with `event_time` earlier than the flight, the actual observation is reconciled, the gated Stage-A update is applied and the as-flown state is committed; inspections apply Stage B; repairs and replacements reset the state. Two instances of the same part number are initialised separately from their own records.
3. **Upcoming-flight conditions** (`twin.resolve_conditions`): Priority 1 — scheduled information (duration, landings, planned payload → load factor via the documented relation f_load = 0.85 + 0.20·payload, forecast temperature, expected environment); Priority 2 — comparable completed flights of the same aircraft on the same route (≥ 2) or any route (≥ 3), median and standard deviation of their recorded actual conditions, restricted to flights earlier than the predicted flight; Priority 3 — documented engineering defaults with stated σ. Every field carries its provenance; estimated fields are listed as assumptions on the prediction.
4. **Pre-flight prediction** (`twin.predict_flight`): stored immutably with component, aircraft and flight IDs, timestamp, model version, input-data version (hash of the records available before the flight), parameters, conditions, predicted channels, predicted damage, RUL and Monte Carlo output. A prediction is refused for a completed flight and never duplicated for a flight.
5. **Post-flight ingestion**: actual conditions and component observations attached to the flight ID (synthetic reference aircraft in the demonstration; `flight_actuals.csv` + `flight_observations.csv` in operation), with quality checks.
6. **Reconciliation** (`reconciliation.reconcile_prediction`): the forecast error (stored prediction vs actual, including schedule deviation) is reported separately from the response-model error (same model version re-run with actual conditions vs actual); only the latter feeds the Stage-A estimate; an explanation attributes the difference.
7. **Updates**: Stage A, Stage B, Stage C as in §7; an unattributable discrepancy inflates prediction uncertainty by 10 % and is flagged for engineering investigation instead of being corrected.
8. **History incorporation and next flight**: the as-flown model estimate advances the state; the next scheduled flight is predicted with the updated twin.

Unit conventions used throughout the engine: stress MPa; crack length m (displayed mm); stress-intensity factor MPa·√m; Paris C in m/cycle per (MPa·√m)^m; temperature K internally (°C in the UI); time s internally (min/h in the UI); pressure MPa internally (bar in channels); strain dimensionless (µε / % in the UI).

## 2. Operational response model (mission → loading → predicted channels)

**Origin.** Phase-based mission decomposition is standard practice for preliminary fatigue spectra; the specific phase tables are documented engineering assumptions (MODEL_ASSUMPTIONS.md §2).

**Inputs.** Mission: duration, phase time fractions (default taxi 8 %, take-off 2 %, climb 15 %, cruise 50 %, manoeuvring 10 %, descent 10 %, landing 5 %), landing cycles, load factor f_load, load variation v, manoeuvre intensity, ambient/inlet temperature, pressure factor, vibration level, environment, operating intensity I. Component: reference load F_ref, effective section A_eff, reference vibratory stress, zone temperature rise, etc. Calibratable response factors: k_L, k_T, k_V, k_P.

**Equations.**

* Structural components: σ_phase = k_L · f_load · I · f_load,phase · σ_ref, σ_ref = F_ref·10³ / A_eff.
* Turbine blade: σ_c,phase = k_L · f_load · I · (N/N_ref)²_phase · σ_c,ref; T_metal,phase = T_amb + k_T · f_T,phase · (T_ref − 288.15 K) · I.
* Actuator: p_phase = k_P · f_p · f_p,phase · p_nom; pressure cycles n_p = Σ_phase rate_phase · t_phase (manoeuvring scaled by intensity) · I.
* Temperature at structural components: T_phase = T_amb + k_T · f_T,phase · ΔT_zone.

**Stress-range bins per flight (structural models).**

* Ground–air–ground: 1 cycle, Δσ = σ_max − σ_min.
* Manoeuvre: n = 20 · intensity · (t_man / 720 s), Δσ = 0.30 · σ_man · max(1, √intensity).
* Vibration HCF: per phase n = t_phase · f_vib, Δσ = k_V · vib_level · f_vib,phase · Δσ_vib,ref.
* Landing gear: touchdown (n = landings, Δσ = σ_landing), taxi bumps (0.5 Hz, 25 % of taxi stress), take-off unloading (1 cycle), retraction/extension (2 per landing, 10 % σ_ref).
* Turbine: start–stop centrifugal (1 cycle), throttle transients (6 per 12 min of manoeuvring × intensity, 15 % σ_man).
* Load variation v: each bin is split 25 % at (1−v)Δσ, 50 % at Δσ, 25 % at (1+v)Δσ. Because fatigue damage is convex in Δσ, higher variation produces more damage.
* Uploaded stress histories are rainflow-counted (ASTM E1049-85 four-point method, `rainflow` package).

**Predicted channels.** load (kN), strain (µε = σ/E·10³ with E in GPa), temperature (°C), pressure (bar), vibration (g RMS) at 30 s intervals, smoothed by a 5-sample moving average. Each channel also stores its *baseline* (channel with the calibratable factor divided out; temperature as rise above ambient), which is the regressor for Stage A.

**Limitations.** Phase tables are surrogates for a validated loads model; no gust spectrum; no aircraft-specific mass/CG effects; linear scaling with load factor.

## 3. Model 1 — Engine mount / pylon lug (fatigue + crack propagation)

**Governing equations.**

* Basquin S-N: N = A / Δσ^m, with endurance limit Δσ_e (N → ∞ below it). Parameters describe the notched net section (K_t included).
* Palmgren–Miner: D = Σ nᵢ/Nᵢ. D = 1 is the conventional threshold, not a failure guarantee.
* Paris–Erdogan: da/dN = C(ΔK)^m for ΔK_th < ΔK, ΔK = Y·Δσ·√(πa), Y = 1.12 (edge crack, constant).
* Critical size: a_c = (K_IC / (Y·σ_max))² / π; K_max = ΔK/(1−R) ≥ K_IC stops integration.

**Numerical method.** Explicit per-bin integration with sub-stepping so that Δa ≤ 2 % of a per sub-step; bins below ΔK_th consume cycles without growth; the step reports `threshold_crossed` at a_c and the sequence stops. Remaining life integrates the reference mission repeatedly until a_c (cap 20 000 flights) and reports flights; S-N life = (1 − D)/ΔD_ref.

**Required inputs.** A, m, Δσ_e, C, m_P, ΔK_th, K_IC, Y, E, F_ref, A_eff, f_vib, Δσ_vib,ref, ΔT_zone, R, a₀.

**Outputs.** ΔD, D, Δa, a, da/dN_max, ΔK_max, a_c, equivalent stress range, cycles, margins, threshold status.

**Assumptions / limitations.** No mean-stress correction; no load-interaction (retardation/acceleration); constant Y; corrosion disabled by default.

## 4. Model 2 — Landing-gear outer cylinder (fatigue + crack + corrosion)

Same fatigue and crack-growth formulation as Model 1 with steel-class illustrative parameters and Y = 1.0; crack growth applied only when a crack has been detected (a > 0). Corrosion surrogate: dp/dt = r₀ · f_env with exposure = flight time + 6 h ground time per landing; f_env ∈ {benign 1.0, humid 1.6, marine 2.5, desert 1.3}; review limit p = 500 µm. Real pitting kinetics are typically sub-linear; the linear form is a documented simplification. Mechanical wear is catalogued only.

## 5. Model 3 — HP turbine blade (creep + thermal fatigue + oxidation)

* Norton secondary creep: ε̇ = A σⁿ exp(−Q/RT), integrated analytically per phase at constant (σ, T) and by the trapezoidal rule for supplied histories. Review limit ε = 1 %.
* Thermal fatigue: Δε = k_c · α · ΔT (constraint factor k_c), Coffin–Manson Δε/2 = ε_f'(2N_f)^c, damage n/N_f per cycle; one major start–stop cycle per flight plus throttle transients at 25 % ΔT.
* Oxidation: x² = k_p t, k_p = k₀ exp(−Q_ox/RT), integrated per phase; review limit 30 µm.
* LCF from centrifugal start–stop cycles is also tracked with an S-N relation.

Limitations: no primary/tertiary creep, no creep–fatigue interaction, no through-wall thermal gradient, no coating model. The model does not replace a thermomechanical blade assessment.

## 6. Model 4 — Hydraulic actuator (seal wear / leakage surrogate)

ΔW = k_w · n_p · (p/p_ref)^α · exp(β(T − T_ref)) · (1 + γW); Q_leak = Q₀ + k_q W; pressure-performance deviation ∝ leakage. Threshold: Q_leak ≥ 0.5 L/min. Remaining cycles are found by iterating the reference mission (wear accelerates with W). This is an empirical, clearly-labelled surrogate with configurable coefficients, not a universal law.

## 7. Two-stage controlled learning

### Stage A — operational model update (after any flight)

For each usable channel c: y_c(t) = θ_c x_c(t) + e(t), where x_c is the baseline regressor of the as-flown re-prediction (actual conditions, same model version). Scalar RLS with forgetting factor λ (default 0.98):
K = Px/(λ + xPx); θ ← θ + K(y − θx); P ← (P − Kx P)/λ. A standard-error proxy is computed from the residual variance. Channel estimates mapping to the same parameter (load and strain → k_L) are combined by reliability-weighted mean. The update applies blend × (θ̂ − θ) to the response parameter, with blend = 1 (accept) or 0.5 (reduced confidence). **Only k_L, k_T, k_V, k_P may change.** Tests verify that crack length and Miner damage are untouched and that model parameters are unchanged.

### Stage B — damage-state update (inspection and maintenance evidence only)

x_post = (x_m/σ_m² + x_i/σ_i²)/(1/σ_m² + 1/σ_i²), σ_post² = 1/(1/σ_m² + 1/σ_i²). A crack measured where the model carried no crack initialises the state at the measurement (new-defect rule) instead of fusing with a zero estimate. A maintenance *repair* sets the stated damage variables; a *replacement* resets the whole state (and the response priors) to a new component. σ_m = √(σ_base² + (g·n_flights)² + (0.03·x)²) grows with flights since the last accepted damage update (constants in MODEL_ASSUMPTIONS.md §6). With reduced confidence the measurement variance is doubled. If the predicted growth since the last accepted update exceeds 3·√(σ_i² + σ_last²) (identifiability), the mechanism rate coefficient (Paris C, k_w, r₀, creep A) is rescaled by (observed/predicted growth)^0.5, bounded ×0.5…×2 per update, and tagged `calibrated`.

### Stage C — evidence gate

Flight observations: reliability = 1 − 1.5·missing − 4·outliers − 0.3·[SNR < 2], clipped to [0, 1]; channels with reliability < 0.4 or < 10 valid samples are excluded; outlier fraction by MAD-robust |z| > 3.5. Decisions: no usable channel or outliers > 15 % → reject; |proposed change| > 40 % → request more evidence; missing > 10 %, outliers > 5 % or SNR < 3 → accept with reduced confidence; otherwise accept.
Inspections: qualitative method → request more evidence; σ_i > 50 % of value → request more evidence; monotonic quantity measured > 3σ below the model → reject (contradictory); |z| > 4 or low inspector confidence → reduced confidence; missing uncertainty → 25 % assumed, reduced confidence.

### Stage D — hidden reference model and synthetic history

Per component instance: true response factors, degradation-coefficient overrides, true damage state at history start, sensor noise σ per channel, optional bias, seed. The synthetic history (`services/history.py`) is one coherent sequence per aircraft: 12 completed flights on three demonstration routes with scheduled information (planned duration, payload, forecast temperature, environment) and actual as-flown conditions (deterministic perturbations), component observations generated with `numpy.random.default_rng(seed·1000 + flight)` as the true state advances, inspections drawn from the true state with stated uncertainty on their dates, and maintenance events (a seal replacement resets the true actuator state). Anomalies (dropout 45 %, outliers 20 %, +60 % scale fault, wrong installation) can be injected when a scheduled flight is completed. The twin API never exposes `truth_state_after`; the Validation page reveals the reference only to measure error.

### Stage E — learning history

Every simulation, observation, reconciliation, inspection and update is stored with monotonic sequence numbers; versions increment only on applied updates; rejected updates are kept.

## 8. Uncertainty and remaining life

Monte Carlo with seeded `default_rng`: parameter class (log-normal, CoV 0.3–0.5), measurement class (normal on initial damage state), operational class (normal on response factors, CoV 0.03–0.08), model-form class (normal on Y or constraint factor). Outputs: P5/P50/P95 sample percentiles per flight, threshold-crossing fraction, Spearman rank sensitivities, input distribution table. **Intervals are not calibrated** and are labelled as such. RUL unit: flights of the reference (normal) mission or hot hours; no calendar conversion.

## 9. Validation procedure

105 pytest tests: physics (closed-form checks, monotonicity, thresholds, unit rejection, rainflow), what-if simulation (sequential accumulation, determinism, distinguishability, threshold stop, twin unchanged), twin lifecycle (separate instance histories, replay determinism, condition-resolution priorities, no leakage from later flights, prediction immutability and pre-flight-only rule, foreign-aircraft rejection, maintenance repair/replacement, dashboard status, A/B/C experiment isolation), reconciliation (residual arithmetic, RLS vs batch least squares, hidden-factor recovery, forecast/as-flown separation, Stage A touches response parameters only, anomaly rejection with uncertainty inflation, commit rules, inspection fusion, new-defect initialisation, contradictory rejection, coefficient identification, history), uncertainty, and API (primary workflow, scheduled-flight entry, demo, CSV datasets, what-if isolation). 17 Vitest tests cover navigation, the historical profile, prediction generation, scheduled-flight entry, what-if labelling, error surfacing, import feedback and formatting.

**Chronological experiment** (`validation.chronological_experiment`): the component's completed flights are replayed in an isolated copy of its records under four variants — A static physics model (no updates), B operationally calibrated (Stage A only), C two-stage (Stage A + inspection/maintenance Stage B), C-sparse (Stage A + only the first quantitative inspection). For each flight the load forecast error, the as-flown response error and the damage-state error against the hidden reference are recorded; remaining life is compared with the reference RUL at the end; improvement across successive flights is reported as first-half vs second-half forecast error. Predictions for flight N use only information available before flight N. Results are in VALIDATION_REPORT.md and live on the Validation page. No claim is made beyond this synthetic experiment.

## 10. Data provenance

All registry entries are `synthetic_demo`; uploaded files become `uploaded`; UI-entered records are `manual`. Parameter provenance: `input`, `assumption`, `measured`, `catalogue`, `simulation`, `calibrated`. No real telemetry, fleet statistics, certified allowables or deployment data are used.

## 11. References

1. Basquin, O. H. (1910). The exponential law of endurance tests. *Proceedings of the American Society for Testing Materials*, 10, 625–630.
2. Miner, M. A. (1945). Cumulative damage in fatigue. *Journal of Applied Mechanics*, 12(3), A159–A164.
3. Paris, P. C., & Erdogan, F. (1963). A critical analysis of crack propagation laws. *Journal of Basic Engineering*, 85(4), 528–533.
4. ASTM E1049-85 (Reapproved 2017). *Standard Practices for Cycle Counting in Fatigue Analysis*. ASTM International.
5. Tada, H., Paris, P. C., & Irwin, G. R. (2000). *The Stress Analysis of Cracks Handbook* (3rd ed.). ASME Press.
6. Anderson, T. L. (2017). *Fracture Mechanics: Fundamentals and Applications* (4th ed.). CRC Press.
7. Dowling, N. E. (2013). *Mechanical Behavior of Materials* (4th ed.). Pearson.
8. Norton, F. H. (1929). *The Creep of Steel at High Temperatures*. McGraw-Hill.
9. Manson, S. S. (1953). Behavior of materials under conditions of thermal stress. *NACA Technical Note 2933*.
10. Coffin, L. F. (1954). A study of the effects of cyclic thermal stresses on a ductile metal. *Transactions of the ASME*, 76, 931–950.
11. Ljung, L. (1999). *System Identification: Theory for the User* (2nd ed.). Prentice Hall.
12. Glaessgen, E., & Stargel, D. (2012). The digital twin paradigm for future NASA and U.S. Air Force vehicles. *53rd AIAA/ASME/ASCE/AHS/ASC Structures, Structural Dynamics and Materials Conference*, AIAA 2012-1818.
