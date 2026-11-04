/** TypeScript mirror of the backend Pydantic/response contracts (backend/app/schemas.py and services). */

export type Provenance = 'input' | 'assumption' | 'measured' | 'catalogue' | 'simulation' | 'calibrated'
export type ModelType = 'engine_mount' | 'landing_gear' | 'turbine_blade' | 'hydraulic_actuator'
export type Profile = 'normal' | 'increased_load' | 'high_temperature' | 'high_manoeuvre' | 'adverse_environment' | 'custom'
export type Environment = 'benign' | 'humid' | 'marine' | 'desert'
export type Decision = 'accept' | 'accept_reduced_confidence' | 'request_more_evidence' | 'reject'
export type ThresholdStatus = 'within_threshold' | 'threshold_crossed' | 'insufficient_evidence'

export interface Parameter {
  name: string
  value: number
  unit: string
  provenance: Provenance
  description: string
}

export interface RemainingLife {
  unit: string
  governing_remaining_flights: number | null
  governing_mechanism: string | null
  [k: string]: unknown
}

export interface Assessment {
  status: 'within_threshold' | 'review' | 'threshold_crossed' | 'not_modelled' | 'invalid_parameters'
  detail: string
  remaining_life: RemainingLife | null
  margins?: Record<string, number>
  min_margin?: number | null
  review_required: boolean
}

export interface Equation {
  name: string
  latex: string
  text: string
}

export interface Aircraft {
  id: string
  aircraft_type: string
  registration_or_demo_id: string
  configuration: Record<string, unknown>
  provenance: string
  components?: { id: string; name: string; model_type: ModelType | null; position: string }[]
  flights_completed?: number
  flights_scheduled?: number
}

export interface ScheduledInfo {
  route?: string
  duration_min: number
  landing_cycles: number
  payload_fraction?: number | null
  expected_temperature_c?: number | null
  expected_environment?: Environment | null
  source?: string
  notes?: string
}

export interface ActualConditions {
  duration_min: number
  landing_cycles: number
  load_factor?: number
  load_variation?: number
  manoeuvre_intensity?: number
  temperature_c?: number
  pressure_factor?: number
  vibration_level?: number
  environment?: Environment
  operating_intensity?: number
  source?: string
}

export interface Flight {
  id: string
  aircraft_id: string
  sequence: number
  flight_date: string
  event_time: string
  route_or_mission: string
  scheduled: ScheduledInfo
  actual: ActualConditions | null
  status: 'scheduled' | 'completed'
  completion_source?: string
  provenance: string
  predictions?: { id: string; component_id: string; flight_id?: string; status: string; model_version?: number; committed?: boolean }[]
  observations?: { id: string; component_id: string; flight_id?: string; label?: string; provenance?: string; anomaly?: string; measured_channels?: string[] }[]
  reconciliations?: { id: string; component_id: string; gate: Gate; summary: Record<string, number>; applied: boolean }[]
}

export interface ConditionResolution {
  conditions: Record<string, number | string>
  provenance: Record<string, string>
  uncertainty: Record<string, number | null>
  comparables_used: string[]
  comparable_basis: string
  notes: string[]
  estimated_fields: string[]
}

export interface Prediction {
  id: string
  component_id: string
  aircraft_id: string
  flight_id: string
  flight_sequence: number
  flight_event_time: string
  prediction_timestamp: string
  model_version: number
  input_data_version: string
  parameters: Record<string, number>
  response_params: Record<string, number>
  state_before: Record<string, number>
  conditions: Record<string, number | string>
  condition_provenance: Record<string, string>
  condition_uncertainty: Record<string, number | null>
  comparables_used: string[]
  assumptions: string[]
  predicted: {
    increments: Record<string, number>
    state_after: Record<string, number>
    outputs: Record<string, number | null>
    remaining_margin: number | null
    threshold_status: ThresholdStatus
    threshold_detail: string
    stress_bins: StressBin[]
    max_stress_mpa: number
    peak_temperature_k: number
    pressure_cycles: number
    remaining_life: RemainingLife
  }
  predicted_channels?: PredictedChannels
  uncertainty: Uncertainty | null
  threshold_crossing_fraction: number | null
  status: 'pending' | 'reconciled' | 'committed'
  committed?: boolean
  reconciliation_id?: string
  as_flown?: { increments: Record<string, number>; state_after: Record<string, number>; threshold_status: ThresholdStatus }
  immutable: boolean
  component_identity_snapshot?: { id: string; manufacturer?: string; part_number?: string; serial_number?: string; installation_date?: string | null }
  reconciliation_status?: string
  created_at: string
}

export interface PredictionSummary {
  id: string
  component_id: string
  aircraft_id: string
  flight_id: string
  flight_sequence: number
  flight_event_time: string
  prediction_timestamp: string
  model_version: number
  input_data_version: string
  status: Prediction['status']
  committed?: boolean
  threshold_crossing_fraction: number | null
  conditions: Record<string, number | string>
  condition_provenance: Record<string, string>
  assumptions: string[]
  predicted_state_after: Record<string, number>
  remaining_life: RemainingLife
}

export interface Maintenance {
  id: string
  component_id: string
  aircraft_id?: string
  maintenance_date: string
  event_time?: string
  activity: string
  repair_or_replacement: 'none' | 'repair' | 'replacement'
  damage_before: Record<string, number> | null
  damage_after: Record<string, number> | null
  maintenance_reference: string
  provenance: string
  applied_in_history?: boolean
  update_id?: string
}

export interface TwinStatus {
  component_id: string
  aircraft_id: string
  history_initialised: boolean
  evidence_summary: {
    completed_flights_with_observations: number; completed_flights_replayed?: number; completed_flights_without_sensor_observations?: number;
    operational_records?: number; load_histories?: number; mapped_load_histories?: number;
    inspections: number; maintenance_records: number; applied_updates: number; rejected_updates: number;
    baseline_provenance: Record<string, string>; stage_a: boolean; stage_b: boolean
  } | null
  data_availability: { observations: number; measured_channels: string[]; operational_records?: number; load_histories?: number; mapped_load_histories?: number; inspections: number; maintenance: number; predictions: number }
  latest_inspection: Inspection | null
  next_scheduled_flight: Flight | null
  last_prediction: Prediction | null
  pending_prediction: Prediction | null
  last_observation: { id: string; flight_id: string; event_time: string; label: string; provenance: string; anomaly: string } | null
  last_reconciliation: { id: string; flight_id: string; gate: Gate; summary: Record<string, number>; forecast_summary: Record<string, number>; applied: boolean; final_decision?: Decision; model_version: number } | null
  latest_accepted_update: ModelUpdate | null
  next_prediction_status: string
}

export interface ComponentHistory {
  component_id: string
  aircraft_id: string
  baseline_state: Record<string, number>
  identity_events?: ComponentIdentityEvent[]
  baseline_provenance: Record<string, string>
  baseline_date: string
  installation_date: string
  part_number: string
  serial_number: string
  observations: { id: string; flight_id: string; flight_date?: string; route?: string; event_time: string; provenance: string; label: string; anomaly: string; measured_channels: string[]; summary: Record<string, { mean: number; max: number; min: number; missing_fraction: number }>; actual_conditions: ActualConditions | null }[]
  operational_records: {
    id: string; operational_date: string; event_time: string; flight_id?: string | null; conditions: Record<string, number | null>;
    environment?: string | null; notes?: string | null; provenance: string; source: string; label: string; automatic_twin_replay: boolean; replay_note: string
  }[]
  load_histories: {
    id: string; event_time?: string | null; flight_id?: string | null; filename: string; provenance: string; label: string;
    stress_basis?: 'not_mapped' | 'critical_net_section'; mapping_provenance?: string; mapping_note?: string;
    n_samples: number; samples: { t_s: number; stress_mpa: number }[];
    rainflow: { n_samples: number; n_cycles: number; max_range_mpa: number; bins: { stress_range_mpa: number; cycles: number; mean_stress_mpa: number }[] };
    automatic_twin_replay: boolean; replay_note: string
  }[]
  inspections: Inspection[]
  maintenance: Maintenance[]
  flight_log: { flight_id: string; sequence: number; prediction_id: string; as_flown_increments: Record<string, number>; state_after: Record<string, number>; ts: string }[]
  evidence_summary: TwinStatus['evidence_summary']
  measured_quantities: string[]
  unavailable_quantities: string[]
}

export interface ExperimentVariant {
  label: string
  flights: { flight_id: string; sequence: number; model_version: number; forecast_rel_error: number | null; as_flown_rel_error: number | null; gate: Decision; state_key: string; twin_state: number; truth_state: number | null; state_error: number | null; predicted_state: number }[]
  mean_forecast_rel_error: number | null
  mean_as_flown_rel_error: number | null
  mean_abs_state_error: number | null
  final_abs_state_error: number | null
  forecast_error_first_half: number | null
  forecast_error_second_half: number | null
  final_model_version: number
  final_response_params: Record<string, number>
  twin_rul_flights: number | null
  truth_rul_flights: number | null
  rul_error_flights: number | null
  gate_decisions: Record<Decision, number>
}

export interface Experiment {
  component_id: string
  key_metric: string
  n_flights: number
  truth_rul_flights: number | null
  summary: Record<string, Omit<ExperimentVariant, 'flights'>>
  variants: Record<string, ExperimentVariant>
  conclusions: { operational_calibration_reduced_forecast_error: boolean; two_stage_reduced_state_error: boolean; note: string }
  leakage_control: string
}

export interface ComponentIdentityEvent {
  id: string
  component_id: string
  related_component_id?: string | null
  event_type: 'identity_correction' | 'component_retired' | 'component_installed_as_replacement' | string
  effective_date: string
  event_time: string
  before_identity: Record<string, string | null> | null
  after_identity: Record<string, string | null> | null
  changes?: Record<string, { before: string | null; after: string | null }>
  reason: string
  maintenance_reference: string
  provenance: string
}

export interface ComponentSummary {
  id: string
  lifecycle_status?: 'active' | 'retired'
  retired_on?: string
  retired_at?: string
  retirement_reason?: string
  replaced_by_component_id?: string
  replaces_component_id?: string
  aircraft_id?: string
  position?: string
  component_type?: ModelType | null
  manufacturer?: string
  part_number?: string
  serial_number?: string
  installation_date?: string
  baseline_state?: Record<string, number>
  baseline_provenance?: Record<string, string>
  baseline_date?: string
  history_initialised?: boolean
  evidence_summary?: TwinStatus['evidence_summary']
  flight_log?: ComponentHistory['flight_log']
  uncertainty_inflation?: number
  name: string
  system: string
  description: string
  material: string
  geometry: Record<string, unknown>
  model_type: ModelType | null
  parameters: Record<string, Parameter>
  state: Record<string, number>
  response_params: Record<string, number>
  initial_condition: string
  degradation_mechanisms: string[]
  inspection_summary: string
  operational_summary: string
  model_version: number
  provenance: 'synthetic_demo' | 'uploaded' | 'manual'
  tags: string[]
  created_at: string
  updated_at: string
  assessment: Assessment
  version_history?: { version: number; update_id: string; stage: string; timestamp: string; summary: string }[]
  committed_flights?: { run_id: string; flight_index: number; profile: string; ts: string }[]
}

export interface ComponentDetail extends ComponentSummary {
  twin: TwinStatus | null
  maintenance: Maintenance[]
  predictions: { id: string; flight_id: string; flight_sequence: number; model_version: number; status: string; prediction_timestamp: string; threshold_crossing_fraction: number | null; committed?: boolean }[]
  model: {
    display_name: string
    mechanisms: string[]
    equations: Equation[]
    relevant_mission_inputs: string[]
    uncertain_parameters: Record<string, { dist: string; cov?: number; sd_abs?: number; class: string }>
  } | null
  inspections: Inspection[]
  model_updates: ModelUpdate[]
  runs: { id: string; label: string; n_flights: number; threshold_status: ThresholdStatus; model_version: number; created_at: string }[]
}

export interface Mission {
  name?: string
  profile: Profile
  duration_min?: number
  landing_cycles?: number
  load_factor?: number
  load_variation?: number
  manoeuvre_intensity?: number
  temperature_c?: number
  pressure_factor?: number
  vibration_level?: number
  environment?: Environment
  operating_intensity?: number
  repeat?: number
}

export interface Scenario {
  id: string
  component_id: string
  name: string
  notes?: string
  missions: Mission[]
  provenance: string
  created_at: string
}

export interface StressBin {
  label: string
  stress_range_mpa: number
  cycles: number
  mean_stress_mpa: number
}

export interface PredictedChannels {
  t_s: number[]
  phase: string[]
  units: Record<string, string>
  ambient_c?: number
  baseline?: Record<string, number[]>
  [channel: string]: unknown
}

export interface FlightRecordSim {
  flight_index: number
  mission_index: number
  profile: Profile
  increments: Record<string, number>
  state_after: Record<string, number>
  outputs: Record<string, number | null>
  remaining_margin: number | null
  threshold_status: ThresholdStatus
  threshold_detail: string
  warnings: string[]
}

export interface MissionEntry {
  index: number
  mission: Mission & { name: string; repeat: number }
  stress_bins: StressBin[]
  max_stress_mpa: number
  peak_temperature_k: number
  pressure_cycles: number
  flights: number[]
  predicted_channels?: PredictedChannels
  damage_added: Record<string, number>
  sn_breakdown?: { label: string; stress_range_mpa: number; cycles: number; cycles_to_failure: number | null; damage: number }[] | null
}

export interface Uncertainty {
  method: string
  seed: number
  n_samples: number
  n_samples_requested: number
  n_flights: number
  key_metric: string
  secondary_metric: string | null
  key_percentiles: { p5: number[]; p50: number[]; p95: number[] }
  secondary_percentiles: { p5: number[]; p50: number[]; p95: number[] } | null
  threshold_crossing_fraction: number
  sensitivity_spearman: Record<string, number>
  input_distributions: Record<string, { dist: string; cov?: number; sd_abs?: number; class: string; nominal: number }>
  calibration_status: string
  uncertainty_classes: Record<'parameter' | 'measurement' | 'operational' | 'model_form', string[]>
}

export interface SimulationRun {
  id: string
  component_id: string
  component_name: string
  model_type: ModelType
  model_version: number
  label: string
  scenario_id: string | null
  provenance: string
  missions: MissionEntry[]
  flights: FlightRecordSim[]
  initial_state: Record<string, number>
  final_state: Record<string, number>
  remaining_life: RemainingLife
  stop_reason: string | null
  threshold_status: ThresholdStatus
  n_flights: number
  parameters_used: Record<string, number>
  response_params_used: Record<string, number>
  uncertainty: Uncertainty | null
  created_at: string
}

export interface SimulationSummary {
  id: string
  component_id: string
  component_name: string
  label: string
  n_flights: number
  threshold_status: ThresholdStatus
  model_version: number
  created_at: string
  scenario_id: string | null
  final_state: Record<string, number>
  remaining_life: RemainingLife
}

export interface CompareResult {
  component_id: string
  model_version: number
  schedules: {
    name: string
    missions: MissionEntry[]
    flights: FlightRecordSim[]
    final_state: Record<string, number>
    remaining_life: RemainingLife
    threshold_status: ThresholdStatus
    uncertainty: Uncertainty | null
  }[]
}

export interface Observation {
  id: string
  component_id: string
  aircraft_id?: string
  flight_id: string
  flight_sequence?: number
  event_time?: string
  source?: string
  measured_channels?: string[]
  label: string
  provenance: 'synthetic_ground_truth' | 'uploaded' | 'manual'
  anomaly: string
  quality_notes: string[]
  created_at: string
  seed?: number
  channels?: { t_s: number[]; phase: string[]; units: Record<string, string>; [k: string]: unknown }
}

export interface ChannelReconciliation {
  unit: string
  n: number
  n_valid?: number
  missing_fraction: number
  rmse?: number
  mae?: number
  mean_bias?: number
  relative_error?: number
  max_abs_residual?: number
  outlier_fraction?: number
  noise_sd_estimate?: number | null
  snr?: number | null
  reliability?: number
  response_param?: string
  theta_twin?: number
  theta_estimate?: number
  theta_standard_error?: number | null
  relative_change?: number | null
  usable: boolean
  note?: string
  predicted?: number[]
  actual?: (number | null)[]
  residual?: (number | null)[]
}

export interface Gate {
  decision: Decision
  reasons: string[]
  max_missing_fraction: number
  max_outlier_fraction: number
  blend: number
}

export interface Reconciliation {
  id: string
  component_id: string
  aircraft_id?: string
  flight_id: string
  prediction_id: string
  flight_record_id: string
  model_version: number
  prediction_model_version?: number
  forecast?: { channels: Record<string, ChannelReconciliation>; mean_relative_error: number; conditions_planned: Record<string, number | string>; condition_provenance?: Record<string, string> }
  forecast_summary?: { mean_relative_error: number }
  actual_conditions?: ActualConditions
  condition_deviation?: Record<string, { planned: number | string; actual: number | string }>
  explanation?: string[]
  observation_label: string
  observation_provenance: string
  observation_anomaly: string
  t_s?: number[]
  phase?: string[]
  channels: Record<string, ChannelReconciliation>
  proposals: Record<string, { before: number; proposed: number; relative_change: number; channels: string[] }>
  gate: Gate
  summary: { mean_relative_error: number; forecast_mean_relative_error?: number; channels_usable: number; channels_total: number; worst_channel: string }
  applied: boolean
  applied_update_id: string | null
  final_decision?: Decision
  note?: string
  created_at: string
}

export interface ModelUpdate {
  id: string
  component_id: string
  flight_id?: string | null
  update_type?: string
  stage: 'A_operational' | 'B_damage_state' | 'C_rejected'
  decision: Decision
  applied: boolean
  version_before: number
  version_after: number
  evidence: Record<string, unknown>
  changes: Record<string, { before: number; after: number; unit?: string; [k: string]: unknown }>
  metrics: Record<string, unknown>
  summary: string
  created_at: string
}

export interface Inspection {
  id: string
  component_id: string
  inspection_date: string
  method: string
  method_label: string
  observed_defect: string
  quantity: string | null
  measured_value: number | null
  unit: string | null
  measurement_uncertainty: number | null
  confidence: 'low' | 'medium' | 'high'
  source: string
  provenance: string
  notes: string
  update: { decision: Decision; applied: boolean; update_id: string; reasons: string[]; z_score: number; posterior_value: number; posterior_sigma: number; unit: string } | null
  created_at: string
}

export interface TimelineEvent {
  ts: string
  seq?: number
  type: 'simulation' | 'observation' | 'reconciliation' | 'inspection' | 'model_update' | 'prediction' | 'maintenance'
  flight_id?: string
  forecast_error?: number
  id: string
  component_id: string
  title: string
  detail: string
  version?: number
  decision?: Decision
  applied?: boolean
  relative_error?: number
  anomaly?: string
}

export interface Overview {
  counts: Record<string, number>
  latest_update: ModelUpdate | null
  latest_reconciliation: Pick<Reconciliation, 'id' | 'component_id' | 'flight_id' | 'gate' | 'summary' | 'created_at' | 'model_version'> | null
  aircraft: Aircraft[]
  components: {
    id: string; name: string; system: string; aircraft_id: string | null; position: string | null; model_type: ModelType | null; model_version: number; provenance: string
    status: Assessment['status']; review_required: boolean; min_margin: number | null; remaining_life: number | null; governing_mechanism: string | null; state: Record<string, number>
    history_initialised: boolean
    data_availability: TwinStatus['data_availability'] | null
    latest_inspection: { inspection_date: string; method_label: string; observed_defect: string; measured_value: number | null; unit: string | null; measurement_uncertainty: number | null } | null
    next_scheduled_flight: { id: string; flight_date: string; route_or_mission: string } | null
    last_prediction: { id: string; flight_id: string; status: string; model_version: number; threshold_crossing_fraction: number | null } | null
    last_observation: TwinStatus['last_observation']
    last_reconciliation: TwinStatus['last_reconciliation']
    latest_accepted_update: { id: string; stage: string; decision: Decision; version_after: number; summary: string; created_at: string } | null
    next_prediction_status: string | null
  }[]
  recent_activity: { id: string; kind: string; message: string; created_at: string; ref: Record<string, unknown> }[]
  recent_runs: { id: string; component_id: string; label: string; n_flights: number; threshold_status: ThresholdStatus; model_version: number; created_at: string }[]
  demo: DemoResult | null
  data_provenance_note: string
}

export interface DemoStep {
  step: number
  title: string
  detail: string
  data: Record<string, unknown>
}

export interface DemoResult {
  id: string
  demo_id: string
  title: string
  component_id: string
  seed: number
  steps: DemoStep[]
  aircraft_id: string
  ids: Record<string, string>
  experiment: Experiment
  key_metric: string
  key_unit: string
  label: string
}

export interface PHM2019Report {
  status: 'ready' | 'not_ready' | 'invalid'
  dataset: string
  data_directory: string
  source_url: string
  challenge_url: string
  download_url?: string
  error?: string
  instructions?: string[]
  warnings?: string[]
  labels_source?: string
  labels_loaded?: number
  specimens?: string[]
  labelled_points_by_specimen?: { specimen: string; points: number }[]
  signal_features?: {
    files_found: number
    files_unparsed: number
    cycles_with_signal_features: number
    labelled_cycles_with_signals: number
    feature_correlations_with_crack_length: Record<string, number | null>
    note: string
  }
  rolling_origin?: {
    summary: {
      scored_points: number
      last_value_mae_mm: number | null
      linear_trend_mae_mm: number | null
      last_value_rmse_mm: number | null
      linear_trend_rmse_mm: number | null
    }
    by_specimen: {
      specimen: string; labelled_points: number; scored_points: number
      last_value_mae_mm: number; linear_trend_mae_mm: number
      last_value_rmse_mm: number; linear_trend_rmse_mm: number
    }[]
    predictions: { specimen: string; cycle: number; actual_mm: number; last_value_mm: number; linear_trend_mm: number }[]
  }
  method_note?: string
  provenance_note?: string
  physics_paris_loo?: {
    status: 'ready' | 'not_run'
    reason?: string | null
    summary?: { scored_points: number; mae_mm: number | null; rmse_mm: number | null }
    by_specimen: {
      specimen: string; status: string; labelled_points?: number; scored_points?: number
      mae_mm?: number; rmse_mm?: number; fitted_parameters?: Record<string, number | string | string[]>
      loading_profile?: string
    }[]
    predictions: { specimen: string; cycle: number; actual_mm: number; previous_observed_mm: number; paris_predicted_mm: number; cycle_interval: number; reached_numerical_guard: boolean }[]
    method_note?: string
    transfer_limit?: string
  }
}

export interface ValidationReport {
  tests: {
    ran_at: string
    elapsed_s: number
    return_code: number
    totals: { passed: number; failed: number; errors: number; skipped: number }
    groups: { file: string; passed: number; total: number; cases: { file: string; name: string; status: string; time_s: number; message: string }[] }[]
    stdout_tail: string
    stderr_tail: string
  }
  experiment: Experiment | null
  demo_comparisons: { demo_id: string; title: string; component_id: string; key_metric: string; key_unit: string; experiment: Experiment; seed: number; label: string }[]
  reference_models: {
    component_id: string; note: string
    true_response_params: Record<string, number>; twin_response_params: Record<string, number>
    true_param_overrides: Record<string, number>; twin_params: Record<string, number>
    true_state: Record<string, number>; twin_state: Record<string, number>
    sensor_noise: Record<string, number>; sensor_bias: Record<string, number>; flights_generated: number
  }[]
}

export interface ModelInfo {
  model_type: ModelType
  display_name: string
  mechanisms: string[]
  equations: Equation[]
  relevant_mission_inputs: string[]
  state_variables: string[]
  parameters: Parameter[]
  uncertain_parameters: Record<string, { dist: string; cov?: number; sd_abs?: number; class: string }>
}

export interface MissionPresets {
  presets: Record<string, Mission & { name: string }>
  phases: string[]
  default_phase_fractions: Record<string, number>
  environments: Environment[]
  phase_tables: Record<ModelType, Record<string, [number, number, number, number]>>
  channel_units: Record<string, string>
  relevant_inputs: Record<ModelType, string[]>
}

export interface Settings {
  id: string
  mc_samples: number
  rls_forgetting_factor: number
  reduced_confidence_blend: number
  max_relative_change_per_update: number
  channel_sample_s: number
  demo_seed: number
}

export interface ImportResult {
  ok: boolean
  dataset: string
  filename?: string
  rows: number
  problems: string[]
  imported: string[] | null
  rainflow?: { n_samples: number; n_cycles: number; max_range_mpa: number; bins: { stress_range_mpa: number; cycles: number; mean_stress_mpa: number }[] }
}

export interface TemplateInfo {
  description: string
  columns: string[]
  required: string[]
  units: Record<string, string>
}

export interface Catalogue {
  systems: string[]
  failure_catalogue: Record<string, string[]>
  implemented: Record<string, ModelType>
}

// ----------------------------------------------------------------- live twin playback
export interface PlaybackBundle {
  component: { id: string; name: string; model_type: ModelType; aircraft_id: string; position: string | null; part_number: string | null; serial_number: string | null; model_version: number }
  flight: Pick<Flight, 'id' | 'sequence' | 'status' | 'flight_date' | 'route_or_mission' | 'scheduled' | 'actual' | 'event_time'>
  prediction_id: string | null
  preview: boolean
  preview_note: string | null
  conditions: Record<string, number | string>
  condition_provenance: Record<string, string> | null
  condition_uncertainty: Record<string, number | null>
  duration_s: number
  phases: { phase: string; start_s: number; end_s: number }[]
  t_s: number[]
  phase: string[]
  predicted: Record<string, number[]>
  band: Record<string, { lo: number[]; hi: number[] }>
  band_note: string
  units: Record<string, string>
  observed: { observation_id: string; label: string; provenance: string; anomaly: string; quality_notes?: string[]; t_s: number[]; phase: string[]; channels: Record<string, (number | null)[]>; units: Record<string, string> } | null
  state_before: Record<string, number>
  increments: Record<string, number>
  state_after: Record<string, number>
  as_flown: { increments: Record<string, number>; state_after: Record<string, number>; threshold_status: ThresholdStatus; provisional?: boolean } | null
  trajectory: Record<string, number[]>
  trajectory_note: string
  limits: Record<string, number | null>
  state_labels: Record<string, { label: string; unit: string; scale: number }>
  response_params: Record<string, number>
  reconciliation: Pick<Reconciliation, 'id' | 'gate' | 'summary' | 'forecast_summary' | 'applied' | 'final_decision' | 'proposals' | 'explanation' | 'model_version'> & { channels?: Record<string, ChannelReconciliation>; condition_deviation?: Record<string, { planned: number | string; actual: number | string }> } | null
  remaining_life: RemainingLife | null
  threshold_status: ThresholdStatus | null
  phase_order: string[]
}

export interface LiveSnapshot {
  server_time: string
  components: { id: string; model_type: ModelType; aircraft_id: string | null; position: string | null; state: Record<string, number>; model_version: number; response_params: Record<string, number>; history_initialised: boolean }[]
  flights: { id: string; status: 'scheduled' | 'completed'; sequence: number; flight_date: string; route_or_mission: string }[]
  counts: Record<string, number>
  activity: Overview['recent_activity']
}
