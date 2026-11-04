import { vi } from 'vitest'

/** In-memory fake of the AeroSim backend for frontend tests (primary workflow + what-if). */
export function installMockApi() {
  const twinBase = { history_initialised: true, evidence_summary: { completed_flights_with_observations: 12, inspections: 2, maintenance_records: 1, applied_updates: 14, rejected_updates: 1, baseline_provenance: {}, stage_a: true, stage_b: true } }
  const state = {
    components: [
      { id: 'ENG-MOUNT-001', aircraft_id: 'AIRCRAFT-001', position: 'LH', part_number: 'DM-EM-4410', serial_number: 'SN-EM-0187', installation_date: '2024-03-10', name: 'Left engine mount — forward pylon lug', system: 'Engine mounting and support', description: 'd', material: 'Ti', geometry: {}, model_type: 'engine_mount', parameters: { K_IC: { name: 'K_IC', value: 75, unit: 'MPa√m', provenance: 'assumption', description: '' } }, state: { miner_damage: 0.38, crack_length_m: 0.006, flights: 1712 }, baseline_state: { miner_damage: 0.36, crack_length_m: 0 }, baseline_provenance: { miner_damage: 'inferred' }, baseline_date: '2026-08-01', response_params: { load_transfer_factor: 1.12, thermal_response_factor: 1, vibration_response_factor: 1, pressure_response_factor: 1 }, initial_condition: 'i', degradation_mechanisms: ['Fatigue'], inspection_summary: '', operational_summary: '', model_version: 15, provenance: 'synthetic_demo', tags: [], created_at: '2026-11-04T00:00:00Z', updated_at: '2026-11-04T00:00:00Z', ...twinBase, assessment: { status: 'within_threshold', detail: 'ok', remaining_life: { unit: 'flights of the reference mission', governing_remaining_flights: 300, governing_mechanism: 'crack_propagation' }, margins: { margin_crack: 0.6 }, min_margin: 0.6, review_required: false }, inspections: [], maintenance: [], model_updates: [], predictions: [], runs: [], twin: null, model: { display_name: 'Engine mount', mechanisms: ['fatigue'], equations: [{ name: 'Paris', latex: '', text: 'da/dN = C(ΔK)^m' }], relevant_mission_inputs: ['duration_min', 'load_factor', 'environment'], uncertain_parameters: {} } },
      { id: 'FAN-BLADE-001', aircraft_id: 'AIRCRAFT-001', name: 'Fan blade', system: 'Propulsion', description: 'd', material: 'Ti', geometry: {}, model_type: null, parameters: {}, state: {}, response_params: {}, initial_condition: '', degradation_mechanisms: ['Erosion'], inspection_summary: '', operational_summary: '', model_version: 1, provenance: 'synthetic_demo', tags: [], created_at: '', updated_at: '', history_initialised: false, assessment: { status: 'not_modelled', detail: '', remaining_life: null, review_required: false }, inspections: [], maintenance: [], model_updates: [], predictions: [], runs: [], twin: null, model: null },
    ],
    flights: [
      { id: 'AC001-F0012', aircraft_id: 'AIRCRAFT-001', sequence: 12, flight_date: '2026-10-28', event_time: '2026-10-28T10:00:00+00:00', route_or_mission: 'DEMO-C → DEMO-A', scheduled: { duration_min: 150, landing_cycles: 1, payload_fraction: 0.8, expected_temperature_c: 24, expected_environment: 'humid' }, actual: { duration_min: 148, landing_cycles: 1, load_factor: 1.01, environment: 'humid' }, status: 'completed', provenance: 'synthetic_demo', predictions: [], observations: [] },
      { id: 'AC001-F0013', aircraft_id: 'AIRCRAFT-001', sequence: 13, flight_date: '2026-11-05', event_time: '2026-11-05T10:00:00+00:00', route_or_mission: 'DEMO-A → DEMO-B', scheduled: { duration_min: 120, landing_cycles: 1, payload_fraction: 0.73, expected_temperature_c: 23.5, expected_environment: 'benign' }, actual: null, status: 'scheduled', provenance: 'synthetic_demo', predictions: [], observations: [] },
    ] as Record<string, unknown>[],
    predictions: [] as Record<string, unknown>[],
    scenarios: [] as Record<string, unknown>[],
    runs: [] as Record<string, unknown>[],
    calls: [] as { method: string; path: string; body?: unknown }[],
  }
  const resolution = { conditions: { duration_min: 120, landing_cycles: 1, load_factor: 0.996, manoeuvre_intensity: 1.1, temperature_c: 23.5, environment: 'benign' }, provenance: { duration_min: 'scheduled', landing_cycles: 'scheduled', load_factor: 'derived from planned payload (documented relation 0.85 + 0.20·payload)', manoeuvre_intensity: 'historical comparable flights (same route, n=4)', temperature_c: 'scheduled (forecast)', environment: 'scheduled' }, uncertainty: { duration_min: null, landing_cycles: null, load_factor: 0.04, manoeuvre_intensity: 0.1, temperature_c: 2.5, environment: null }, comparables_used: ['AC001-F0003'], comparable_basis: 'same route', notes: [], estimated_fields: ['load_factor', 'manoeuvre_intensity'] }
  const mkPrediction = (flight_id: string) => ({
    id: `pred-${state.predictions.length + 1}`, component_id: 'ENG-MOUNT-001', aircraft_id: 'AIRCRAFT-001', flight_id, flight_sequence: 13, flight_event_time: '2026-11-05T10:00:00+00:00', prediction_timestamp: '2026-11-04T12:00:00Z', model_version: 15, input_data_version: 'obs12-insp2-mnt1-abc', parameters: { K_IC: 75 }, response_params: { load_transfer_factor: 1.12 }, state_before: { crack_length_m: 0.006, miner_damage: 0.38 },
    conditions: resolution.conditions, condition_provenance: resolution.provenance, condition_uncertainty: resolution.uncertainty, comparables_used: [], assumptions: ['Conditions load_factor are estimated, not confirmed.'],
    predicted: { increments: { crack_length_m: 1.7e-5, miner_damage: 3e-5 }, state_after: { crack_length_m: 0.006017, miner_damage: 0.38003 }, outputs: {}, remaining_margin: 0.6, threshold_status: 'within_threshold', threshold_detail: 'ok', stress_bins: [{ label: 'gag', stress_range_mpa: 200, cycles: 1, mean_stress_mpa: 100 }], max_stress_mpa: 278, peak_temperature_k: 370, pressure_cycles: 0, remaining_life: { unit: 'flights of the reference mission', governing_remaining_flights: 346, governing_mechanism: 'crack_propagation' } },
    uncertainty: null, threshold_crossing_fraction: 0, status: 'pending', immutable: true, created_at: '2026-11-04T12:00:00Z',
  })
  const run = (missions: Record<string, unknown>[]) => ({
    id: `run-${state.runs.length + 1}`, component_id: 'ENG-MOUNT-001', component_name: 'Engine mount', model_type: 'engine_mount', model_version: 15, label: 'test', scenario_id: null, provenance: 'what_if',
    missions: missions.map((m, i) => ({ index: i, mission: { ...m, name: `M${i + 1}`, repeat: 1 }, stress_bins: [{ label: 'gag', stress_range_mpa: 200, cycles: 1, mean_stress_mpa: 100 }], max_stress_mpa: 240, peak_temperature_k: 350, pressure_cycles: 0, flights: [i + 1], damage_added: { crack_length_m: 1e-5 } })),
    flights: missions.map((m, i) => ({ flight_index: i + 1, mission_index: i, profile: m.profile, increments: { miner_damage: 1e-5, crack_length_m: 1e-5 }, state_after: { miner_damage: 0.38 + (i + 1) * 1e-5, crack_length_m: 0.006 + (i + 1) * 1e-5, flights: 1713 + i }, outputs: { max_stress_mpa: 240 }, remaining_margin: 0.6, threshold_status: 'within_threshold', threshold_detail: 'ok', warnings: [] })),
    initial_state: { miner_damage: 0.38, crack_length_m: 0.006 }, final_state: { miner_damage: 0.38 + missions.length * 1e-5, crack_length_m: 0.006 + missions.length * 1e-5 },
    remaining_life: { unit: 'flights of the reference mission', governing_remaining_flights: 300, governing_mechanism: 'crack_propagation' }, stop_reason: null, threshold_status: 'within_threshold', n_flights: missions.length,
    parameters_used: { K_IC: 75 }, response_params_used: { load_transfer_factor: 1.12 }, uncertainty: null, created_at: '2026-11-04T00:00:00Z',
  })
  const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })
  const twinStatus = () => ({ component_id: 'ENG-MOUNT-001', aircraft_id: 'AIRCRAFT-001', ...twinBase, data_availability: { observations: 12, measured_channels: ['load_kN'], inspections: 2, maintenance: 1, predictions: state.predictions.length }, latest_inspection: null, next_scheduled_flight: state.predictions.length ? null : state.flights[1], last_prediction: state.predictions.at(-1) ?? null, pending_prediction: null, last_observation: null, last_reconciliation: null, latest_accepted_update: null, next_prediction_status: 'ready — next scheduled flight AC001-F0013' })
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString()
    const path = url.replace(/^\/api/, '')
    const method = init?.method ?? 'GET'
    const body = init?.body && typeof init.body === 'string' ? JSON.parse(init.body) : undefined
    state.calls.push({ method, path, body })
    if (path === '/health') return json({ status: 'ok', components: 2 })
    if (path === '/live') return json({ server_time: '2026-11-04T00:00:00Z', components: state.components.filter((c) => c.model_type).map((c) => ({ id: c.id, model_type: c.model_type, aircraft_id: c.aircraft_id, position: c.position ?? null, state: c.state, model_version: c.model_version, response_params: c.response_params, history_initialised: !!c.history_initialised })), flights: state.flights.map((f) => ({ id: f.id, status: f.status, sequence: f.sequence, flight_date: f.flight_date, route_or_mission: f.route_or_mission })), counts: { predictions: state.predictions.length, observations: 12, reconciliations: 0, inspections: 2, updates: 15 }, activity: [] })
    if (path === '/overview') return json({ aircraft: [{ id: 'AIRCRAFT-001', aircraft_type: 'Demo type', registration_or_demo_id: 'DEMO-001', configuration: {}, provenance: 'synthetic_demo' }], counts: { components: 2, modelled_components: 1, review_required: 0, flights_completed: 12, flights_scheduled: 3, predictions: state.predictions.length, observations: 12, reconciliations: 0, inspections: 2, maintenance: 1, model_updates_applied: 14, model_updates_rejected: 1, what_if_runs: state.runs.length }, latest_update: null, latest_reconciliation: null, components: state.components.map((c) => ({ id: c.id, name: c.name, system: c.system, aircraft_id: c.aircraft_id, position: c.position ?? '', model_type: c.model_type, model_version: c.model_version, provenance: 'synthetic_demo', status: c.assessment.status, review_required: false, min_margin: null, remaining_life: null, governing_mechanism: null, state: c.state, history_initialised: !!c.history_initialised, data_availability: c.model_type ? { observations: 12, measured_channels: ['load_kN'], inspections: 2, maintenance: 1, predictions: 0 } : null, latest_inspection: null, next_scheduled_flight: c.model_type ? { id: 'AC001-F0013', flight_date: '2026-11-05', route_or_mission: 'DEMO-A → DEMO-B' } : null, last_prediction: null, last_observation: null, last_reconciliation: null, latest_accepted_update: null, next_prediction_status: c.model_type ? 'ready — next scheduled flight AC001-F0013' : null })), recent_activity: [], demo: null, data_provenance_note: 'note' })
    if (path === '/aircraft') return json([{ id: 'AIRCRAFT-001', aircraft_type: 'Demo type', registration_or_demo_id: 'DEMO-001', configuration: {}, provenance: 'synthetic_demo', components: [], flights_completed: 12, flights_scheduled: 3 }])
    if (path.match(/^\/components\/[^/]+\/history$/)) return json({ component_id: 'ENG-MOUNT-001', aircraft_id: 'AIRCRAFT-001', baseline_state: { crack_length_m: 0 }, baseline_provenance: {}, baseline_date: '2026-08-01', installation_date: '2024-03-10', part_number: 'x', serial_number: 'y', observations: [{ id: 'obs-1', flight_id: 'AC001-F0012', flight_date: '2026-10-28', route: 'r', event_time: '2026-10-28T10:00:00+00:00', provenance: 'synthetic_ground_truth', label: 'SYNTHETIC', anomaly: 'none', measured_channels: ['load_kN'], summary: { load_kN: { mean: 90, max: 150, min: 20, missing_fraction: 0 } }, actual_conditions: { duration_min: 148, landing_cycles: 1 } }], inspections: [], maintenance: [], flight_log: [], evidence_summary: twinBase.evidence_summary, measured_quantities: ['load_kN'], unavailable_quantities: ['pressure_bar'] })
    if (path.startsWith('/components/')) {
      const c = state.components.find((x) => x.id === path.split('/')[2])
      return c ? json({ ...c, twin: c.model_type ? twinStatus() : null }) : json({ detail: 'Component not found' }, 404)
    }
    if (path.startsWith('/components')) return json(path.includes('modelled=true') ? state.components.filter((c) => c.model_type) : state.components)
    if (path === '/catalogue') return json({ systems: ['Propulsion', 'Engine mounting and support'], failure_catalogue: { Propulsion: ['Fan-blade erosion'] }, implemented: {} })
    if (path === '/missions/presets') return json({ presets: { normal: { name: 'Normal operation', profile: 'normal' }, increased_load: { name: 'Increased-load operation', profile: 'increased_load', load_factor: 1.25 } }, phases: ['taxi'], default_phase_fractions: { taxi: 1 }, environments: ['benign', 'marine'], phase_tables: {}, channel_units: { load_kN: 'kN' }, relevant_inputs: { engine_mount: ['duration_min', 'load_factor', 'environment'] } })
    if (path.startsWith('/twin/') && path.endsWith('/next-flight')) return json({ flight: state.predictions.length ? null : state.flights[1], resolution: state.predictions.length ? null : resolution })
    if (path.startsWith('/twin/') && path.endsWith('/initialise') && method === 'POST') return json({ component: { ...state.components[0], model_version: 15 }, metrics: [] })
    if (path.startsWith('/twin/')) return json(twinStatus())
    if (path.startsWith('/flights') && method === 'GET') return json(state.flights)
    if (path === '/flights' && method === 'POST') {
      const f = { id: 'AC001-F0016', aircraft_id: body.aircraft_id, sequence: 16, flight_date: body.flight_date, event_time: `${body.flight_date}T10:00:00+00:00`, route_or_mission: body.route_or_mission, scheduled: { duration_min: body.duration_min, landing_cycles: body.landing_cycles ?? 1, payload_fraction: body.payload_fraction, expected_temperature_c: body.expected_temperature_c, expected_environment: body.expected_environment }, actual: null, status: 'scheduled', provenance: 'manual', predictions: [], observations: [] }
      state.flights.push(f)
      return json(f, 201)
    }
    if (path === '/predictions' && method === 'POST') {
      if (state.predictions.some((p) => p.flight_id === body.flight_id)) return json({ detail: 'A pre-flight prediction already exists; predictions are immutable.' }, 422)
      const p = mkPrediction(body.flight_id)
      state.predictions.push(p)
      return json(p, 201)
    }
    if (path.startsWith('/predictions/')) return json(state.predictions.find((p) => p.id === path.split('/')[2]) ?? { detail: 'nf' }, state.predictions.some((p) => p.id === path.split('/')[2]) ? 200 : 404)
    if (path.startsWith('/predictions')) return json(state.predictions.map((p) => ({ ...p, predicted_state_after: (p.predicted as { state_after: unknown }).state_after, remaining_life: (p.predicted as { remaining_life: unknown }).remaining_life })))
    if (path.startsWith('/scenarios') && method === 'GET') return json(state.scenarios)
    if (path === '/scenarios' && method === 'POST') {
      const s = { id: `scn-${state.scenarios.length + 1}`, ...body, provenance: 'manual', created_at: '' }
      state.scenarios.push(s)
      return json(s, 201)
    }
    if (path === '/simulations' && method === 'POST') {
      if (body.missions.some((m: { load_factor?: number }) => (m.load_factor ?? 1) > 3)) return json({ detail: 'load_factor must be between 0.2 and 3.0' }, 422)
      const r = run(body.missions)
      state.runs.unshift(r)
      return json(r)
    }
    if (path.startsWith('/simulations/') && method === 'GET') return json(state.runs.find((r) => r.id === path.split('/')[2]) ?? { detail: 'nf' }, state.runs.some((r) => r.id === path.split('/')[2]) ? 200 : 404)
    if (path.startsWith('/simulations')) return json(state.runs)
    if (path.startsWith('/observations')) return json([])
    if (path.startsWith('/reconciliations')) return json([])
    if (path.startsWith('/inspections/methods')) return json({ methods: { ultrasonic: { label: 'Ultrasonic crack measurement', quantities: ['crack_length_m'], quantitative: true } }, quantity_units: { crack_length_m: 'mm' } })
    if (path.startsWith('/inspections')) return json([])
    if (path.startsWith('/maintenance')) return json([])
    if (path.startsWith('/model-history')) return json({ timeline: [], updates: [], reconciliations: [] })
    if (path === '/settings') return json({ id: 'app', mc_samples: 300, rls_forgetting_factor: 0.98, reduced_confidence_blend: 0.5, max_relative_change_per_update: 0.4, channel_sample_s: 30, demo_seed: 42 })
    if (path === '/data/templates') return json({ flight_observations: { description: 'x', columns: ['a'], required: ['a'], units: {} } })
    if (path === '/data/imports') return json([])
    if (path.startsWith('/data/import')) return json({ ok: false, dataset: 'flight_observations', rows: 1, problems: ['Missing required column(s): t_s.'], imported: null })
    if (path === '/demo') return json({ available: [], results: [] })
    if (path === '/models') return json({ models: [], default_response_params: {} })
    return json({ detail: `unmocked ${method} ${path}` }, 404)
  })
  vi.stubGlobal('fetch', fetchMock)
  return { state, fetchMock }
}
