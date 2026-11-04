import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import { AppRoutes } from '../App'
import { MissionEditor } from '../components/MissionEditor'
import { useAppStore } from '../store/useAppStore'
import { installMockApi } from './mockApi'
import type { Mission } from '../api/types'

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes />
    </MemoryRouter>,
  )
}

describe('mission editor', () => {
  it('adds, duplicates and removes missions and clamps the repeat count', async () => {
    let missions: Mission[] = [{ profile: 'normal' }]
    const onChange = (m: Mission[]) => { missions = m; rerender(<MissionEditor missions={missions} onChange={onChange} presets={null} modelType="engine_mount" />) }
    const { rerender } = render(<MissionEditor missions={missions} onChange={onChange} presets={null} modelType="engine_mount" />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /Add mission/ }))
    expect(missions).toHaveLength(2)
    await user.click(screen.getAllByRole('button', { name: 'Duplicate' })[0])
    expect(missions).toHaveLength(3)
    await user.click(screen.getAllByRole('button', { name: 'Remove mission' })[2])
    expect(missions).toHaveLength(2)
    const repeat = screen.getAllByLabelText('Flights in block')[0]
    await user.clear(repeat)
    await user.type(repeat, '999')
    expect(missions[0].repeat).toBe(50)
  })

  it('shows only inputs relevant to the selected model', () => {
    const presets = { presets: {}, phases: [], default_phase_fractions: {}, environments: ['benign'], phase_tables: {}, channel_units: {}, relevant_inputs: { hydraulic_actuator: ['pressure_factor'] } } as never
    render(<MissionEditor missions={[{ profile: 'normal' }]} onChange={() => undefined} presets={presets} modelType="hydraulic_actuator" />)
    expect(screen.getByText(/System pressure/)).toBeInTheDocument()
    expect(screen.queryByText(/Landing cycles/)).not.toBeInTheDocument()
  })
})

describe('scenario and simulation workflows', () => {
  beforeEach(() => {
    useAppStore.setState({ draftMissions: [{ profile: 'normal' }], lastRunId: null, lastReconciliationId: null, lastPredictionId: null, selectedComponentId: 'ENG-MOUNT-001' })
  })

  it('saves a scenario from the mission studio', async () => {
    const { state } = installMockApi()
    renderAt('/missions')
    const user = userEvent.setup()
    await screen.findByText('Upcoming mission sequence')
    await user.type(screen.getByPlaceholderText('Scenario name'), 'Test seq')
    await user.click(screen.getByRole('button', { name: /Save scenario/ }))
    await waitFor(() => expect(state.scenarios).toHaveLength(1))
    expect(state.scenarios[0]).toMatchObject({ component_id: 'ENG-MOUNT-001', name: 'Test seq' })
    expect(await screen.findByText('Test seq')).toBeInTheDocument()
  })

  it('generates an immutable pre-flight prediction for the next scheduled flight', async () => {
    const { state } = installMockApi()
    renderAt('/predictions')
    const user = userEvent.setup()
    expect(await screen.findByText('AC001-F0013')).toBeInTheDocument()
    expect(screen.getByText(/historical comparable flights/)).toBeInTheDocument()
    const btn = await screen.findByTestId('predict')
    await waitFor(() => expect(btn).not.toBeDisabled())
    await user.click(btn)
    expect(await screen.findByText(/Prediction pred-1/)).toBeInTheDocument()
    expect(screen.getByText('Conditions used and their provenance')).toBeInTheDocument()
    expect(state.calls.some((c) => c.method === 'POST' && c.path === '/predictions' && (c.body as { flight_id: string }).flight_id === 'AC001-F0013')).toBe(true)
    expect(useAppStore.getState().lastPredictionId).toBe('pred-1')
  })

  it('enters a known upcoming flight on the flights page', async () => {
    const { state } = installMockApi()
    renderAt('/flights')
    const user = userEvent.setup()
    await screen.findByText('Upcoming flight schedule')
    await user.click(screen.getByRole('button', { name: /Enter scheduled flight/ }))
    await user.click(screen.getByRole('button', { name: /Save scheduled flight/ }))
    await waitFor(() => expect(state.flights.some((f) => f.id === 'AC001-F0016')).toBe(true))
    expect(await screen.findByText('AC001-F0016')).toBeInTheDocument()
  })

  it('what-if simulation runs from the current twin and shows the what-if label', async () => {
    const { state } = installMockApi()
    renderAt('/simulation')
    const user = userEvent.setup()
    const btn = await screen.findByTestId('run-simulation')
    await waitFor(() => expect(btn).not.toBeDisabled())
    await user.click(btn)
    expect(await screen.findByText(/Run run-1/)).toBeInTheDocument()
    expect(screen.getByText('Mission-by-mission progression')).toBeInTheDocument()
    expect(screen.getAllByText(/NOT AN ACTUAL SCHEDULED FLIGHT/).length).toBeGreaterThan(0)
    expect(state.calls.some((c) => c.method === 'POST' && c.path === '/simulations')).toBe(true)
    expect(useAppStore.getState().lastRunId).toBe('run-1')
  })

  it('surfaces backend validation errors from the simulation form', async () => {
    installMockApi()
    useAppStore.setState({ draftMissions: [{ profile: 'normal', load_factor: 9 }] })
    renderAt('/simulation')
    const user = userEvent.setup()
    const btn = await screen.findByTestId('run-simulation')
    await waitFor(() => expect(btn).not.toBeDisabled())
    await user.click(btn)
    expect(await screen.findByText(/load_factor must be between/)).toBeInTheDocument()
  })

  it('reports CSV import problems verbatim on the settings page', async () => {
    installMockApi()
    renderAt('/settings')
    const user = userEvent.setup()
    await screen.findByText('Import CSV')
    const file = new File(['component_id\nEM-001'], 'bad.csv', { type: 'text/csv' })
    const input = document.querySelector('input[type=file]') as HTMLInputElement
    await user.upload(input, file)
    await user.click(screen.getByRole('button', { name: /^Validate$/ }))
    expect(await screen.findByText(/Missing required column/)).toBeInTheDocument()
  })

  it('reconciliation page guides the user when no prediction exists', async () => {
    installMockApi()
    renderAt('/reconciliation')
    expect(await screen.findByText(/No prediction yet/)).toBeInTheDocument()
    expect(screen.getByTestId('reconcile')).toBeDisabled()
  })
})
