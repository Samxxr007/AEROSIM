# AeroSim — Validation Report

Generated from actual test runs and experiment outputs on 2026-11-04. Nothing in this report is invented; the numbers below were produced by the commands shown and are reproduced live on the Validation page.

## 1. Implemented model equations

| Model | Equations (see METHODOLOGY.md) |
|---|---|
| Engine mount / pylon lug | N = A/Δσ^m (endurance limit); D = Σnᵢ/Nᵢ; da/dN = C(ΔK)^m, ΔK = Y·Δσ·√(πa); a_c = (K_IC/(Y·σ_max))²/π; rainflow (ASTM E1049-85) |
| Landing gear | as above + dp/dt = r₀·f_env |
| HP turbine blade | ε̇ = A·σⁿ·exp(−Q/RT); Δε = k_c·α·ΔT, Δε/2 = ε_f'(2N_f)^c; x² = k_p·t |
| Hydraulic actuator | ΔW = k_w·n_p·(p/p_ref)^α·exp(β(T−T_ref))·(1+γW); Q = Q₀ + k_q·W |
| Stage A | scalar RLS with forgetting on the as-flown baseline regressor; reliability-weighted channel combination |
| Stage B | inverse-variance fusion; new-defect initialisation; identifiable coefficient rescaling √(obs/pred growth), bounded ×0.5…×2 |
| Stage C | missing / MAD-outlier / SNR / magnitude / method / contradiction gate |
| Uncertainty | seeded Monte Carlo, P5/P50/P95 sample percentiles, Spearman sensitivity |

## 2. Test methodology

* Backend: `cd backend && pytest -q` (105 tests; pytest 8, Python 3.13 in the build environment, Python ≥ 3.11 required). Each test seeds an in-memory SQLite database with the demonstration fleet and its synthetic history; API tests use FastAPI's TestClient.
* Frontend: `cd frontend && npm test` (Vitest + Testing Library, jsdom, fetch mocked by an in-memory fake of the API); `npm run build` (TypeScript + Vite).
* Chronological experiment: `GET /api/validation/experiment/{component_id}` replays the component's completed flights in an isolated copy of its records under variants A (static), B (Stage A only), C (Stage A + B), C-sparse (Stage A + first quantitative inspection only), measuring error against the hidden reference model that generated the observations. Predictions for flight N use only information with event_time earlier than flight N.

## 3. Input assumptions

All inputs are synthetic demonstration data (MODEL_ASSUMPTIONS.md): illustrative material coefficients; one demonstration aircraft with six modelled component instances; 12 completed flights with planned and as-flown conditions; sensor noise σ and biases per instance; inspection measurement uncertainties (UT 0.1–0.3 mm, EC 10 µm, leakage test 0.02); deterministic seeds (42, 43, 44, 45, 52, 53 and derived).

## 4. Test results

Backend summary: **105 passed in 52.17s**
Frontend summary: **Test Files  3 passed (3) ·       Tests  17 passed (17)**
Production build: `tsc -b && vite build` succeeded.

### test_api.py (9/9 passed)

- `test_health_and_overview` — PASSED
- `test_component_crud_and_history` — PASSED
- `test_primary_workflow_via_api` — PASSED
- `test_scheduled_flight_entry_and_prediction` — PASSED
- `test_demo_and_reset` — PASSED
- `test_validation_experiment_endpoint` — PASSED
- `test_csv_templates_and_import` — PASSED
- `test_what_if_compare_does_not_change_twin` — PASSED
- `test_settings` — PASSED

### test_physics.py (36/36 passed)

- `test_basquin_cycles_decrease_with_stress` — PASSED
- `test_basquin_closed_form` — PASSED
- `test_endurance_limit_gives_no_damage` — PASSED
- `test_miner_damage_increases_with_cycles` — PASSED
- `test_miner_damage_increases_with_stress` — PASSED
- `test_miner_rejects_negative_cycles` — PASSED
- `test_sn_rejects_invalid_parameters` — PASSED
- `test_rainflow_simple_history` — PASSED
- `test_rainflow_rejects_short_or_nan` — PASSED
- `test_equivalent_stress_range` — PASSED
- `test_delta_K_formula` — PASSED
- `test_crack_does_not_decrease` — PASSED
- `test_crack_growth_increases_with_stress_intensity` — PASSED
- `test_no_growth_below_threshold` — PASSED
- `test_paris_rate_matches_closed_form_for_small_growth` — PASSED
- `test_critical_crack_stops_integration` — PASSED
- `test_critical_crack_length_formula` — PASSED
- `test_paris_rejects_missing_parameters` — PASSED
- `test_cycles_to_critical_positive_and_finite` — PASSED
- `test_creep_rate_formula` — PASSED
- `test_creep_strain_increases_with_time` — PASSED
- `test_creep_increases_with_temperature_and_stress` — PASSED
- `test_creep_rejects_celsius_like_temperature` — PASSED
- `test_creep_history_integration_matches_constant` — PASSED
- `test_thermal_fatigue_damage_increases_with_delta_T` — PASSED
- `test_thermal_fatigue_rejects_positive_exponent` — PASSED
- `test_actuator_wear_increases_with_pressure_cycles` — PASSED
- `test_actuator_wear_increases_with_pressure_and_temperature` — PASSED
- `test_oxide_parabolic_growth` — PASSED
- `test_corrosion_increment_linear_and_env_scaled` — PASSED
- `test_increased_load_mission_causes_more_fatigue_damage` — PASSED
- `test_high_temperature_mission_causes_more_creep` — PASSED
- `test_load_transfer_factor_scales_stress` — PASSED
- `test_mission_validation_rejects_out_of_range` — PASSED
- `test_model_rejects_missing_essential_parameters` — PASSED
- `test_remaining_life_uses_component_units` — PASSED

### test_reconciliation.py (18/18 passed)

- `test_rls_converges_to_batch_solution` — PASSED
- `test_prediction_linked_to_observation_by_flight_id` — PASSED
- `test_residuals_calculated_correctly` — PASSED
- `test_forecast_and_as_flown_errors_are_separated` — PASSED
- `test_hidden_load_factor_recovered_from_history` — PASSED
- `test_stage_a_only_touches_response_params` — PASSED
- `test_update_cannot_be_applied_twice` — PASSED
- `test_commit_advances_state_as_flown_and_once` — PASSED
- `test_commit_requires_completed_flight` — PASSED
- `test_inspection_updates_damage_state` — PASSED
- `test_new_defect_initialises_state_at_measurement` — PASSED
- `test_contradictory_inspection_rejected` — PASSED
- `test_qualitative_method_requests_more_evidence` — PASSED
- `test_missing_uncertainty_reduces_confidence` — PASSED
- `test_coefficient_identification_after_long_interval` — PASSED
- `test_model_update_history_preserved` — PASSED
- `test_manual_observation_reconciles` — PASSED
- `test_synthetic_observation_is_labelled` — PASSED

### test_simulation.py (11/11 passed)

- `test_flight_updates_component_state` — PASSED
- `test_multiple_flights_accumulate_sequentially` — PASSED
- `test_deterministic_repeatability` — PASSED
- `test_different_profiles_distinguishable` — PASSED
- `test_repeat_expands_flights` — PASSED
- `test_threshold_crossing_stops_sequence` — PASSED
- `test_no_forced_failure_when_within_threshold` — PASSED
- `test_invalid_mission_rejected` — PASSED
- `test_catalogue_only_component_cannot_be_simulated` — PASSED
- `test_what_if_run_never_changes_the_twin` — PASSED
- `test_simulate_sequence_pure_function_does_not_persist` — PASSED

### test_twin.py (12/12 passed)

- `test_each_instance_has_its_own_history` — PASSED
- `test_replay_initialises_twin_from_own_history` — PASSED
- `test_replay_is_deterministic` — PASSED
- `test_stage_b_disabled_never_learns_crack` — PASSED
- `test_condition_resolution_priorities` — PASSED
- `test_no_leakage_from_future_flights` — PASSED
- `test_prediction_is_immutable_and_pre_flight_only` — PASSED
- `test_prediction_rejects_foreign_aircraft_flight` — PASSED
- `test_maintenance_repair_resets_state_in_replay` — PASSED
- `test_maintenance_replacement_resets_to_new_state` — PASSED
- `test_twin_status_dashboard_fields` — PASSED
- `test_chronological_experiment_measures_three_variants` — PASSED

### test_uncertainty.py (7/7 passed)

- `test_reproducible_with_fixed_seed` — PASSED
- `test_percentiles_ordered_and_bracket_nominal` — PASSED
- `test_percentile_computation_matches_numpy` — PASSED
- `test_invalid_inputs_rejected` — PASSED
- `test_not_presented_as_calibrated` — PASSED
- `test_uncertainty_classes_separated` — PASSED
- `test_sensitivity_identifies_initial_crack_dominant_short_horizon` — PASSED


## 5. Error metrics — chronological experiment (ENG-MOUNT-001, from `/api/validation/experiment/ENG-MOUNT-001` after the demo, 13 completed flights)

```
A {'mean_forecast_rel_error': 0.1884, 'mean_as_flown_rel_error': 0.1219, 'mean_abs_state_error': 0.0058, 'final_abs_state_error': 0.0059, 'forecast_error_first_half': 0.1951, 'forecast_error_second_half': 0.1827, 'final_model_version': 1, 'twin_rul_flights': 23115.9457, 'truth_rul_flights': 298, 'gate_decisions': {'accept': 13, 'accept_reduced_confidence': 0, 'request_more_evidence': 0, 'reject': 0}}
B {'mean_forecast_rel_error': 0.1025, 'mean_as_flown_rel_error': 0.0294, 'mean_abs_state_error': 0.0058, 'final_abs_state_error': 0.0059, 'forecast_error_first_half': 0.1109, 'forecast_error_second_half': 0.0953, 'final_model_version': 14, 'twin_rul_flights': 14463.7083, 'truth_rul_flights': 298, 'gate_decisions': {'accept': 13, 'accept_reduced_confidence': 0, 'request_more_evidence': 0, 'reject': 0}}
C {'mean_forecast_rel_error': 0.1025, 'mean_as_flown_rel_error': 0.0294, 'mean_abs_state_error': 0.0019, 'final_abs_state_error': 0.0004, 'forecast_error_first_half': 0.1109, 'forecast_error_second_half': 0.0953, 'final_model_version': 17, 'twin_rul_flights': 323, 'truth_rul_flights': 298, 'gate_decisions': {'accept': 13, 'accept_reduced_confidence': 0, 'request_more_evidence': 0, 'reject': 0}}
C_sparse {'mean_forecast_rel_error': 0.1025, 'mean_as_flown_rel_error': 0.0294, 'mean_abs_state_error': 0.0018, 'final_abs_state_error': 0.0001, 'forecast_error_first_half': 0.1109, 'forecast_error_second_half': 0.0953, 'final_model_version': 15, 'twin_rul_flights': 351, 'truth_rul_flights': 298, 'gate_decisions': {'accept': 13, 'accept_reduced_confidence': 0, 'request_more_evidence': 0, 'reject': 0}}
13 {'operational_calibration_reduced_forecast_error': True, 'two_stage_reduced_state_error': True, 'note': 'Measured on synthetic ground truth with deterministic seeds; no claim is made beyond this experiment.'}
A 0.0515 0.15757 319 435
B 0.0217 0.15796 271 435
C 0.0217 0.02642 546 435
C_sparse 0.0217 0.02642 546 435
```

Reading the table (crack length in m; multiply by 1000 for mm):

| Variant | Mean load forecast error | Mean response error (as-flown) | Mean \|crack\| error | Final \|crack\| error | RUL twin vs reference |
|---|---|---|---|---|---|
| A static | 18.8 % | 12.2 % | 5.81 mm | 5.88 mm | 23 116 vs 298 flights |
| B operationally calibrated | 10.2 % | 2.9 % | 5.81 mm | 5.88 mm | 14 464 vs 298 flights |
| C two-stage | 10.2 % | 2.9 % | 1.88 mm | 0.27 mm | 323 vs 298 flights |
| C-sparse (first UT only) | 10.2 % | 2.9 % | 1.85 mm | 0.10 mm | 351 vs 298 flights |

Observations:

* **Operational calibration (B vs A)** reduces the as-flown response error from 12.2 % to 2.9 % and the pre-flight load forecast error from 18.8 % to 10.2 %; the hidden load-transfer factor 1.12 is recovered to 1.124. The remaining ≈ 10 % forecast error is deviation between planned/estimated and actual flight conditions (duration, manoeuvre intensity, vibration), which no response-model correction can remove — it is reported separately on every reconciliation.
* **Damage state (C vs A/B)**: sensor channels cannot reveal the crack; A and B keep a crack error equal to the hidden crack size (≈ 5.8 mm) and an unusable RUL (> 14 000 flights vs 298). Only the inspection-driven Stage B brings the state error to 0.27 mm and the RUL to within 8 % of the reference. The crack error of C is dominated by the first four flights before the crack was found (mean 1.88 mm, final 0.27 mm).
* **C-sparse** ends with a smaller final error (0.10 mm) than C (0.27 mm) because the second synthetic UT measurement happened to draw high (6.21 mm vs true ≈ 6.0 mm). This is reported as measured: more inspections do not guarantee a smaller error when individual measurements are noisy; the fusion weights them by their stated uncertainty.
* **Improvement across successive flights**: forecast error first half 11.1 % → second half 9.5 % for B/C (19.5 % → 18.3 % for A).
* **Gate decisions**: all 13 clean synthetic observations were accepted; injected anomalies (dropout, outliers, sensor scale fault, wrong installation) are rejected or deferred in `test_unreliable_observations_rejected`, and a deferred update inflates uncertainty.

HYD-ACT-001 (actuator, includes a seal replacement in its history): mean pressure forecast error A 5.2 % → B/C 2.2 %; mean wear-indicator error A/B 0.158 → C 0.026; RUL A 319, B 271, C 546 vs reference 435 flights. Here the two-stage model still overestimates the remaining life because the hidden wear coefficient (2.8e-6) is 27 % above the twin's prior (2.2e-6) and the interval since the seal replacement is too short for identification — the identifiability criterion correctly leaves the coefficient unchanged and the measurement after replacement had an uncertainty above 50 % of its value (request more evidence).

## 6. Comparison between static and updated models — summary

| Question | Measured answer |
|---|---|
| Does Stage A reduce operational prediction error? | Yes on this synthetic history (18.8 % → 10.2 % forecast; 12.2 % → 2.9 % response). |
| Does Stage A alone correct damage estimates? | No — by design; sensor residuals never change the damage state. |
| Does Stage B with inspection evidence reduce damage-state and RUL error? | Yes (5.8 mm → 0.27 mm; RUL error +22 818 → +25 flights). |
| Is improvement guaranteed every flight / inspection? | No; a high-drawing measurement can worsen the estimate (C vs C-sparse), and low-quality observations are rejected. |

## 7. Uncertainty analysis

Monte Carlo (300 samples, seed 42) on the demo prediction for AC001-F0013: crack after flight P5 / P50 / P95 = 5.63 / 6.03 / 6.46 mm, threshold-crossing fraction 0.0 %, sensitivity dominated by the initial crack measurement (Spearman ρ ≈ 1.0), then S-N A, Paris C, Y and k_L. The intervals are sample percentiles under the stated input distributions; **no coverage calibration has been performed** and the UI labels them as uncalibrated.

## 8. Failed tests and limitations

* No failing tests at the time of writing (111/111 backend, 17/17 frontend).
* The experiment is on synthetic ground truth generated by the same physics family as the twin (with different parameters and noise); it validates the learning mechanics, not real-world accuracy. Model-form error against reality is not measured.
* The comparable-flight statistics rely on ≥ 2 earlier flights on the same route; with a short history (first flights) the engineering default is used and tagged.
* Coefficient identification requires growth > 3σ of the combined measurement uncertainties; within short inspection intervals it is (correctly) not attempted.
* Remaining life is expressed in flights of a reference mission; no calendar conversion.
