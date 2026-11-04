# AeroSim — API Documentation

Base URL: `http://127.0.0.1:8000/api`. Interactive OpenAPI docs: `http://127.0.0.1:8000/docs`. All responses are JSON; errors use `{"detail": …}` with 404 (not found), 409 (conflict), 413 (file too large) or 422 (validation / engineering rule violated). Request bodies are validated by Pydantic (`backend/app/schemas.py`); the TypeScript mirror is `frontend/src/api/types.ts`.

## Meta

| Method | Path | Description |
|---|---|---|
| GET | `/health` | `{status, components}` |
| GET | `/overview` | Dashboard: aircraft, counts, per-component twin status (history availability, latest inspection, state, next flight, last prediction/observation/reconciliation/update, next-prediction status), latest update/reconciliation, activity, demo result |
| GET | `/models` | Implemented degradation models: equations, state variables, parameters, uncertain inputs |
| GET | `/missions/presets` | What-if presets, phases, phase tables, environments, channel units, relevant inputs per model |
| GET | `/catalogue` | Aircraft systems, extended failure catalogue, implemented mechanisms |

## Aircraft and component instances

| Method | Path | Description |
|---|---|---|
| GET | `/aircraft` | Aircraft with their component instances and flight counts |
| GET | `/components?system=&q=&modelled=&aircraft_id=` | Component instances with assessment |
| GET | `/components/{id}` | Instance + assessment + twin status + model description + inspections, maintenance, updates, predictions, what-if runs |
| GET | `/components/{id}/history` | **Component Historical Profile**: baseline with provenance, per-flight observation summaries (measured / unavailable channels), inspections, maintenance, flight log, evidence summary |
| POST | `/components` | Create an instance (`ComponentIn`: name, system, aircraft_id, part/serial numbers, installation_date, model_type, parameters, state → baseline, …) |
| PUT | `/components/{id}` | Edit profile / parameters / state (validated by the model); manufacturer/part/serial identity cannot be silently overwritten |
| GET | `/components/{id}/identity-events` | Audited component identity corrections and replacement events |
| POST | `/components/{id}/identity-change` | Correct manufacturer/part/serial with effective date, reason, provenance and maintenance reference; records before/after identity |
| POST | `/components/{id}/replace` | Retire old instance and create a new component ID with a new serial, installation date, baseline/model version 1 and predecessor link; old predictions/history remain attached to the retired ID |

## Twin lifecycle

| Method | Path | Description |
|---|---|---|
| GET | `/twin/{id}` | Twin status (history initialised, evidence summary, data availability, next scheduled flight, last prediction, pending prediction, last observation, last reconciliation, latest accepted update, next-prediction status) |
| POST | `/twin/{id}/initialise` | Reset to baseline and replay the instance's own history chronologically → current condition, model version, audit trail |
| POST | `/twin/initialise-all` | Same for every modelled instance |
| GET | `/twin/{id}/next-flight` | Next scheduled flight without a prediction + resolved conditions with provenance/±σ |
| GET | `/twin/{id}/resolve/{flight_id}` | Condition resolution for a given flight |

## Flights

| Method | Path | Description |
|---|---|---|
| GET | `/flights?aircraft_id=&status=` | Flights with scheduled info, actual info (completed only), status, attached predictions/observations |
| GET | `/flights/{id}` | Flight with predictions, observations, reconciliations |
| POST | `/flights` | Enter a known upcoming flight (`ScheduledFlightIn`: aircraft_id, flight_date, route_or_mission, duration_min, landing_cycles, payload_fraction?, expected_temperature_c?, expected_environment?) |
| POST | `/flights/complete` | Demonstration: `{flight_id, anomaly}` — the hidden reference aircraft flies the scheduled flight; actual conditions and synthetic observations for every modelled instance are recorded (anomaly ∈ none, dropout, outliers, sensor_bias, wrong_component) |

## Predictions (immutable)

| Method | Path | Description |
|---|---|---|
| POST | `/predictions` | `{component_id, flight_id, mc_samples?, seed?}` → pre-flight prediction record (422 if the flight is completed or already predicted) |
| GET | `/predictions?component_id=&flight_id=` | Summaries |
| GET | `/predictions/{id}` | Full record incl. predicted channels and Monte Carlo |
| POST | `/predictions/{id}/commit` | Incorporate the completed flight into the instance's operating history (as-flown model estimate) |

## Observations and reconciliation

| Method | Path | Description |
|---|---|---|
| GET | `/observations?component_id=&flight_id=` | Observation summaries (label, provenance, source, anomaly, measured channels) |
| GET | `/observations/{id}` | Full record (channels); hidden-truth fields are never returned |
| POST | `/observations/manual` | `{component_id, flight_id, channel_means, note}` testing aid for a completed flight |
| POST | `/reconciliations` | `{prediction_id, flight_record_id?}` → forecast vs as-flown comparison, residuals, reliability, proposals, gate, explanation |
| GET | `/reconciliations?component_id=` / `/reconciliations/{id}` | List / detail |
| POST | `/reconciliations/{id}/apply` | `{decision_override?}` apply the Stage-A gate decision (response parameters only); a deferred decision inflates uncertainty |

## Inspections and maintenance

| Method | Path | Description |
|---|---|---|
| GET | `/inspections?component_id=` · `/inspections/methods` | Records · supported methods and quantity units |
| POST | `/inspections` | `InspectionIn` → stored record + Stage-B decision/update |
| POST | `/inspections/synthetic?component_id=&quantity=&measurement_sd=&method=&seed=` | Demonstration measurement drawn from the hidden reference |
| GET | `/maintenance?component_id=` | Maintenance records |
| POST | `/maintenance` | `MaintenanceIn` (activity, repair_or_replacement, damage_after, apply) → record + repair update; physical replacement is rejected here and must use `/components/{id}/replace` |

## History and validation

| Method | Path | Description |
|---|---|---|
| GET | `/model-history?component_id=` | Timeline (predictions, observations, reconciliations, inspections, maintenance, updates), update records, reconciliation summaries |
| GET | `/validation?force=&component_id=` | pytest results (cached 10 min unless `force`) + chronological experiment + demo results + revealed reference models |
| GET | `/validation/experiment/{component_id}` | Chronological A / B / C / C-sparse experiment only |
| GET | `/validation/external/phm2019` | Local PHM 2019 coupon benchmark: rolling-origin baselines, leave-one-specimen-out Paris-integrator MAE/RMSE and parsing warnings; returns `not_ready` until the user supplies local files |

## Secondary what-if (never changes the twin)

| Method | Path | Description |
|---|---|---|
| GET/POST/DELETE | `/scenarios` | Saved hypothetical sequences |
| POST | `/simulations` | `SimulationRequest` → what-if run (`provenance: what_if`) |
| GET | `/simulations?component_id=` / `/simulations/{id}` | Runs |
| POST | `/simulations/compare` | `CompareRequest` → schedules compared from the current twin |

## Demo, settings, data

| Method | Path | Description |
|---|---|---|
| POST | `/demo/run?demo_id=engine_mount|hydraulic_actuator&reset=true` | 15-step deterministic sequence + chronological experiment |
| GET | `/demo` · POST `/demo/reset` | Available demos / results · reset to the seeded fleet and history |
| GET/PUT | `/settings` | mc_samples, rls_forgetting_factor, reduced_confidence_blend, max_relative_change_per_update, demo_seed |
| GET | `/data/templates` · `/data/templates/{dataset}.csv` | Template metadata · downloadable CSV (datasets: flight_schedule, flight_actuals, flight_observations, predicted_outputs, inspection_findings, maintenance_records, operational_records, material_properties, load_history). Operational summaries accept optional `flight_id`; load histories accept optional `flight_id` and `stress_basis=not_mapped|critical_net_section`. |
| POST | `/data/import?dataset=&commit=` (multipart `file`) | Strict validation (`commit=false` = dry run); exact problems returned. Linked operational summaries feed the component's as-flown history after aircraft/date checks; sensor-based Stage A still requires observation channels. Stress traces preserve ordered seconds/MPa samples and rainflow bins; only an explicit linked engine-mount `critical_net_section` declaration feeds the as-flown crack-growth calculation. Unmapped traces are archived only. |
| GET | `/data/imports` · `/activity` | Import records · activity log |
