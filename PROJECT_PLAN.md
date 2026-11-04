# AeroSim — Project Plan

**Historical-Data-Driven, Self-Evolving Aircraft Component Digital Twin**
*Learn from every actual flight. Update with reliable inspection evidence. Improve the next component-life prediction.*

## 0. Repository state and revision history

The GitHub repository `Samxxr007/AEROSIM` was empty at the start. The first implementation (scenario-driven forward simulation) was then revised under the *Master Architecture Correction* so that each component's own historical data and flight-by-flight records are the foundation of every prediction, and hypothetical scenario simulation became a secondary what-if tool. Working parts were preserved (physics engine, response model, Stage A/B/C logic, evidence gate, CSV validation, charts, schematics, UI design system); the data architecture, services, API and primary pages were reworked.

## 1. Architecture

```
AEROSIM/
├── backend/
│   ├── app/
│   │   ├── main.py · config.py · db.py (SQLite JSON-document store, json_extract filtering) · schemas.py
│   │   ├── engine/            PURE physics (no I/O): base, fatigue, crack_growth, creep, thermal_fatigue,
│   │   │                      surrogates, response (flight conditions → loading/channels), component_models, registry
│   │   ├── services/
│   │   │   ├── seed.py        demonstration fleet: aircraft, component instances, hidden reference models, settings
│   │   │   ├── history.py     chronologically consistent synthetic history (flights, observations, inspections, maintenance)
│   │   │   ├── twin.py        condition resolution, immutable predictions, as-flown commit, maintenance, chronological replay, status
│   │   │   ├── reconciliation.py  prediction ↔ observation by flight ID, forecast vs as-flown split, gate, Stage A
│   │   │   ├── inspection.py  Stage B fusion, new-defect rule, coefficient identification
│   │   │   ├── calibration.py RLS · uncertainty.py Monte Carlo · model_history.py audit trail
│   │   │   ├── validation.py  pytest runner + chronological A/B/C/C-sparse experiment (isolated copy)
│   │   │   ├── csv_import.py  9 datasets, strict validation · demo.py 15-step deterministic sequence
│   │   │   └── simulation.py  secondary what-if sequences (never change the twin)
│   │   └── api/routes.py
│   ├── scripts/generate_example_dataset.py
│   └── tests/                 physics · simulation · twin · reconciliation · uncertainty · api (105 tests)
├── frontend/src/              pages: Overview, Components (+ twin & historical profile), Flights, Predictions,
│                              Reconciliation, Inspections & maintenance, Model evolution, Validation,
│                              What-if mission studio, What-if sequence simulation, Methodology, Settings
├── data/                      templates + example synthetic dataset
└── docs                       README, METHODOLOGY, MODEL_ASSUMPTIONS, VALIDATION_REPORT, API_DOCUMENTATION, DEMO_SCRIPT
```

## 2. Data entities (SQLite collections)

| Entity | Key fields |
|---|---|
| aircraft | id, aircraft_type, registration_or_demo_id, configuration |
| components (instances) | id, aircraft_id, component_type/model_type, manufacturer, part_number, serial_number, installation_date, parameters (provenance-tagged), baseline_state + baseline_provenance, state, response_params, model_version, history_initialised, evidence_summary, flight_log |
| flights | id, aircraft_id, sequence, flight_date, event_time, route_or_mission, scheduled {…}, actual {…} \| null, status |
| flight_records (component observations) | id, component_id, aircraft_id, flight_id, event_time, label, provenance, source, anomaly, quality_notes, measured_channels, channels (time series); `truth_state_after` is validation-only and never exposed |
| inspections | id, component_id, inspection_date, method, observed_defect, quantity, measured_value, unit, measurement_uncertainty, confidence, source, provenance, update |
| maintenance | id, component_id, maintenance_date, activity, repair_or_replacement, damage_before, damage_after, maintenance_reference |
| predictions (immutable) | id, component_id, aircraft_id, flight_id, prediction_timestamp, model_version, input_data_version, parameters, response_params, state_before, conditions + provenance + uncertainty, assumptions, predicted {…}, predicted_channels, uncertainty, status |
| reconciliations | id, component_id, flight_id, prediction_id, flight_record_id, forecast {…}, channels (as-flown), proposals, gate, explanation, applied |
| model_updates | id, component_id, flight_id, update_type, stage, decision, previous/updated parameters, evidence_used, acceptance_status |
| ground_truth | hidden reference model per instance (validation only) |

## 3. Primary workflow (implemented)

1. Historical ingestion per instance (synthetic history or CSV: flight_schedule → flight_actuals → flight_observations → inspection_findings / maintenance_records).
2. Twin initialisation by chronological replay (`twin.replay_history`), per instance, with leakage control.
3. Next scheduled flight → `twin.resolve_conditions` (scheduled → comparable earlier flights → engineering estimate).
4. `twin.predict_flight` → immutable prediction record (Monte Carlo optional).
5. Flight completion → actual conditions + observations by flight ID (`history.complete_flight_synthetic` or CSV).
6. `reconciliation.reconcile_prediction` → forecast vs as-flown split, gate, proposals, explanation.
7. `reconciliation.apply_operational_update` (Stage A) → `twin.commit_prediction` (as-flown state).
8. `inspection.add_inspection` / `twin.apply_maintenance` (Stage B).
9. Next-flight prediction with the updated twin; `validation.chronological_experiment` for A/B/C comparison.

## 4. Implementation stages

| Stage | Scope | Status |
|---|---|---|
| 1 | Scaffold, plan, physics engine + tests | done |
| 2 | Scenario-driven simulation, reconciliation, learning, UI (first version) | done, then revised |
| 3 | Architecture correction: fleet/instances, flights, synthetic history, twin lifecycle, immutable predictions, flight-ID reconciliation, maintenance, A/B/C experiment | done |
| 4 | UI revision: dashboard, flights, predictions, reconciliation, historical profile, inspections & maintenance, model evolution, validation, what-if relabelling | done |
| 5 | Tests (105 backend, 17 frontend), screenshots, end-to-end UI drive | done |
| 6 | Documentation | done |

## 5. Key engineering decisions and assumptions

* Units: stress MPa, crack length m (mm in UI), ΔK MPa·√m, temperature K (°C in UI), time s, pressure MPa (bar in channels).
* The forecast error of a prediction is reported separately from the response-model error obtained by re-running the same model version with the actual flight conditions; only the latter drives Stage A, so schedule deviation is never mistaken for a response-model fault.
* Only inspection measurements and maintenance records change the damage state; a crack found where the model carried none initialises the state at the measurement.
* Monte Carlo intervals are sample percentiles, explicitly uncalibrated; remaining life is expressed in flights of a reference mission.
* The what-if simulator runs from the component's current calibrated twin and never writes to it.
* The application makes no airworthiness, dispatch or maintenance decisions.
