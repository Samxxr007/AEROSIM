import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import { AppRoutes } from '../App'
import { useAppStore } from '../store/useAppStore'
import { installMockApi } from './mockApi'

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes />
    </MemoryRouter>,
  )
}

describe('navigation', () => {
  beforeEach(() => {
    installMockApi()
    useAppStore.setState({ draftMissions: [{ profile: 'normal' }], lastRunId: null, lastReconciliationId: null, lastPredictionId: null, selectedComponentId: 'ENG-MOUNT-001' })
  })

  it('renders the overview with real counts from the API', async () => {
    renderAt('/overview')
    expect(await screen.findByText('Fleet overview')).toBeInTheDocument()
    expect(await screen.findByText('Run demo sequence')).toBeInTheDocument()
    expect(screen.getByText(/ready — next scheduled flight AC001-F0013/)).toBeInTheDocument()
  })

  it('navigates between sidebar routes', async () => {
    renderAt('/overview')
    const user = userEvent.setup()
    await user.click(await screen.findByRole('link', { name: /Component registry/ }))
    expect(await screen.findByRole('heading', { name: 'Component registry' })).toBeInTheDocument()
    await user.click(screen.getByRole('link', { name: /Methodology/ }))
    expect(await screen.findByRole('heading', { name: 'Methodology' })).toBeInTheDocument()
    expect(screen.getByText(/research and engineering demonstration prototype/)).toBeInTheDocument()
  })

  it('redirects unknown routes to the overview', async () => {
    renderAt('/does-not-exist')
    expect(await screen.findByText('Fleet overview')).toBeInTheDocument()
  })

  it('shows the component registry and filters by search', async () => {
    renderAt('/components')
    expect(await screen.findByText('Left engine mount — forward pylon lug')).toBeInTheDocument()
    expect(screen.getByText('Fan blade')).toBeInTheDocument()
    const user = userEvent.setup()
    await user.type(screen.getByPlaceholderText(/ID, name, S\/N/), 'fan')
    await waitFor(() => expect(screen.queryByText('Left engine mount — forward pylon lug')).not.toBeInTheDocument())
    expect(screen.getByText('Fan blade')).toBeInTheDocument()
  })

  it('renders a component workspace with equations and state', async () => {
    renderAt('/components/ENG-MOUNT-001')
    expect(await screen.findByText(/ENG-MOUNT-001 — Left engine mount/)).toBeInTheDocument()
    expect(await screen.findByText('damage state vs review limits')).toBeInTheDocument()
    expect(screen.getByText('Crack length a')).toBeInTheDocument()
    expect(screen.getByText('6.000 mm')).toBeInTheDocument()
    expect(screen.getAllByText(/own history/).length).toBeGreaterThan(0)
  })

  it('shows the historical profile tab with the component\'s own records', async () => {
    renderAt('/components/ENG-MOUNT-001?tab=history')
    expect(await screen.findByText('Historical sensor observations')).toBeInTheDocument()
    expect(await screen.findByText('AC001-F0012')).toBeInTheDocument()
    expect(screen.getByText(/unavailable: Pressure/)).toBeInTheDocument()
  })
})
