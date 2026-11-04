import type {
  Aircraft, Catalogue, CompareResult, ComponentDetail, ComponentHistory, ComponentSummary, ConditionResolution, DemoResult, Experiment, Flight, ImportResult, Inspection, Maintenance, Mission, MissionPresets, ModelInfo,
  LiveSnapshot, ModelUpdate, Observation, Overview, PlaybackBundle, Prediction, PredictionSummary, Reconciliation, Scenario, Settings, SimulationRun, SimulationSummary, TemplateInfo, TimelineEvent, TwinStatus, ValidationReport, PHM2019Report,
} from './types'

export const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api'

export class ApiError extends Error {
  status: number
  detail: unknown
  constructor(status: number, detail: unknown) {
    super(typeof detail === 'string' ? detail : Array.isArray(detail) ? detail.map((d: { loc?: unknown[]; msg?: string }) => `${(d.loc ?? []).slice(1).join('.')}: ${d.msg}`).join('; ') : JSON.stringify(detail))
    this.status = status
    this.detail = detail
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { headers: init?.body instanceof FormData ? undefined : { 'Content-Type': 'application/json' }, ...init })
  if (!res.ok) {
    let detail: unknown = res.statusText
    try {
      detail = (await res.json()).detail ?? detail
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, detail)
  }
  const ct = res.headers.get('content-type') ?? ''
  return (ct.includes('application/json') ? res.json() : res.text()) as Promise<T>
}

const get = <T>(p: string) => request<T>(p)
const post = <T>(p: string, body?: unknown) => request<T>(p, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })
const put = <T>(p: string, body?: unknown) => request<T>(p, { method: 'PUT', body: JSON.stringify(body) })
const del = <T>(p: string) => request<T>(p, { method: 'DELETE' })

export const api = {
  health: () => get<{ status: string; components: number }>('/health'),
  overview: () => get<Overview>('/overview'),
  models: () => get<{ models: ModelInfo[]; default_response_params: Record<string, number> }>('/models'),
  missionPresets: () => get<MissionPresets>('/missions/presets'),
  catalogue: () => get<Catalogue>('/catalogue'),

  aircraft: () => get<Aircraft[]>('/aircraft'),
  components: (params?: { system?: string; q?: string; modelled?: boolean; aircraft_id?: string }) => {
    const qs = new URLSearchParams()
    if (params?.system) qs.set('system', params.system)
    if (params?.q) qs.set('q', params.q)
    if (params?.aircraft_id) qs.set('aircraft_id', params.aircraft_id)
    if (params?.modelled !== undefined) qs.set('modelled', String(params.modelled))
    const s = qs.toString()
    return get<ComponentSummary[]>(`/components${s ? `?${s}` : ''}`)
  },
  component: (id: string) => get<ComponentDetail>(`/components/${id}`),
  componentHistory: (id: string) => get<ComponentHistory>(`/components/${id}/history`),
  twin: (id: string) => get<TwinStatus>(`/twin/${id}`),
  initialiseTwin: (id: string) => post<{ component: ComponentSummary; metrics: unknown[] }>(`/twin/${id}/initialise`),
  initialiseAll: () => post<{ component_id: string; model_version: number }[]>('/twin/initialise-all'),
  nextFlight: (id: string) => get<{ flight: Flight | null; resolution: ConditionResolution | null }>(`/twin/${id}/next-flight`),
  playback: (id: string, flightId: string) => get<PlaybackBundle>(`/twin/${id}/playback/${flightId}`),
  live: () => get<LiveSnapshot>('/live'),
  resolveConditions: (id: string, flightId: string) => get<ConditionResolution>(`/twin/${id}/resolve/${flightId}`),
  flights: (params?: { aircraft_id?: string; status?: 'scheduled' | 'completed' }) => {
    const qs = new URLSearchParams()
    if (params?.aircraft_id) qs.set('aircraft_id', params.aircraft_id)
    if (params?.status) qs.set('status', params.status)
    const s = qs.toString()
    return get<Flight[]>(`/flights${s ? `?${s}` : ''}`)
  },
  flight: (id: string) => get<Flight>(`/flights/${id}`),
  createFlight: (body: { aircraft_id: string; flight_date: string; route_or_mission: string; duration_min: number; landing_cycles?: number; payload_fraction?: number | null; expected_temperature_c?: number | null; expected_environment?: string | null; notes?: string }) => post<Flight>('/flights', body),
  completeFlight: (flight_id: string, anomaly = 'none') => post<{ flight: Flight; observation_ids: string[] }>('/flights/complete', { flight_id, anomaly }),
  predict: (body: { component_id: string; flight_id: string; mc_samples?: number | null; seed?: number | null }) => post<Prediction>('/predictions', body),
  predictions: (params?: { component_id?: string; flight_id?: string }) => {
    const qs = new URLSearchParams()
    if (params?.component_id) qs.set('component_id', params.component_id)
    if (params?.flight_id) qs.set('flight_id', params.flight_id)
    const s = qs.toString()
    return get<PredictionSummary[]>(`/predictions${s ? `?${s}` : ''}`)
  },
  prediction: (id: string) => get<Prediction>(`/predictions/${id}`),
  commitPrediction: (id: string) => post<ComponentSummary>(`/predictions/${id}/commit`),
  maintenance: (componentId?: string) => get<Maintenance[]>(`/maintenance${componentId ? `?component_id=${componentId}` : ''}`),
  createMaintenance: (body: Record<string, unknown>) => post<{ maintenance: Maintenance; update: ModelUpdate | null; component: ComponentSummary }>('/maintenance', body),
  experiment: (componentId: string) => get<Experiment>(`/validation/experiment/${componentId}`),
  createComponent: (body: Record<string, unknown>) => post<ComponentDetail>('/components', body),
  updateComponent: (id: string, body: Record<string, unknown>) => put<ComponentDetail>(`/components/${id}`, body),

  scenarios: (componentId?: string) => get<Scenario[]>(`/scenarios${componentId ? `?component_id=${componentId}` : ''}`),
  createScenario: (body: { component_id: string; name: string; missions: Mission[]; notes?: string }) => post<Scenario>('/scenarios', body),
  deleteScenario: (id: string) => del<{ deleted: string }>(`/scenarios/${id}`),

  simulate: (body: { component_id: string; missions: Mission[]; label?: string; scenario_id?: string | null; mc_samples?: number | null; seed?: number | null }) => post<SimulationRun>('/simulations', body),
  simulations: (componentId?: string) => get<SimulationSummary[]>(`/simulations${componentId ? `?component_id=${componentId}` : ''}`),
  simulation: (id: string) => get<SimulationRun>(`/simulations/${id}`),
  compare: (body: { component_id: string; schedules: { component_id: string; name: string; missions: Mission[] }[]; mc_samples?: number }) => post<CompareResult>('/simulations/compare', body),

  manualObservation: (body: { component_id: string; flight_id: string; channel_means: Record<string, number>; note?: string }) => post<Observation>('/observations/manual', body),
  observations: (params?: { component_id?: string; flight_id?: string }) => {
    const qs = new URLSearchParams()
    if (params?.component_id) qs.set('component_id', params.component_id)
    if (params?.flight_id) qs.set('flight_id', params.flight_id)
    const s = qs.toString()
    return get<Observation[]>(`/observations${s ? `?${s}` : ''}`)
  },
  observation: (id: string) => get<Observation>(`/observations/${id}`),

  reconcile: (body: { prediction_id: string; flight_record_id?: string | null }) => post<Reconciliation>('/reconciliations', body),
  reconciliations: (componentId?: string) => get<Reconciliation[]>(`/reconciliations${componentId ? `?component_id=${componentId}` : ''}`),
  reconciliation: (id: string) => get<Reconciliation>(`/reconciliations/${id}`),
  applyReconciliation: (id: string, decision_override?: string | null) => post<{ reconciliation: Reconciliation; update: ModelUpdate; component: ComponentSummary }>(`/reconciliations/${id}/apply`, { decision_override: decision_override ?? null }),

  inspections: (componentId?: string) => get<Inspection[]>(`/inspections${componentId ? `?component_id=${componentId}` : ''}`),
  inspectionMethods: () => get<{ methods: Record<string, { label: string; quantities: string[]; quantitative: boolean }>; quantity_units: Record<string, string> }>('/inspections/methods'),
  createInspection: (body: Record<string, unknown>) => post<Inspection>('/inspections', body),
  syntheticInspection: (componentId: string, quantity: string, measurement_sd: number, method: string, seed: number) =>
    post<Inspection>(`/inspections/synthetic?component_id=${componentId}&quantity=${quantity}&measurement_sd=${measurement_sd}&method=${method}&seed=${seed}`),

  modelHistory: (componentId?: string) => get<{ timeline: TimelineEvent[]; updates: ModelUpdate[]; reconciliations: Pick<Reconciliation, 'id' | 'component_id' | 'flight_id' | 'model_version' | 'gate' | 'summary' | 'created_at'>[] }>(`/model-history${componentId ? `?component_id=${componentId}` : ''}`),
  validation: (force = false, componentId = 'ENG-MOUNT-001') => get<ValidationReport>(`/validation?force=${force}&component_id=${componentId}`),
  phm2019: () => get<PHM2019Report>('/validation/external/phm2019'),

  demos: () => get<{ available: { id: string; title: string; component_id: string }[]; results: DemoResult[] }>('/demo'),
  runDemo: (demoId: string, reset = true) => post<DemoResult>(`/demo/run?demo_id=${demoId}&reset=${reset}`),
  resetDemo: () => post<{ reset: boolean }>('/demo/reset'),

  settings: () => get<Settings>('/settings'),
  updateSettings: (body: Partial<Settings>) => put<Settings>('/settings', body),
  templates: () => get<Record<string, TemplateInfo>>('/data/templates'),
  templateUrl: (dataset: string) => `${API_BASE}/data/templates/${dataset}.csv`,
  importCsv: (dataset: string, file: File, commit = true) => {
    const fd = new FormData()
    fd.append('file', file)
    return request<ImportResult>(`/data/import?dataset=${dataset}&commit=${commit}`, { method: 'POST', body: fd })
  },
  imports: () => get<unknown[]>('/data/imports'),
  activity: () => get<Overview['recent_activity']>('/activity'),
}
