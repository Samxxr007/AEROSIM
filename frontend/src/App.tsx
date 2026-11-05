import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import AppShell from './components/layout/AppShell'
import ComponentDetailPage from './pages/ComponentDetailPage'
import ComponentsPage from './pages/ComponentsPage'
import FlightsPage from './pages/FlightsPage'
import PredictionsPage from './pages/PredictionsPage'
import InspectionsPage from './pages/InspectionsPage'
import LiveTwinPage from './pages/LiveTwinPage'
import MethodologyPage from './pages/MethodologyPage'
import MissionsPage from './pages/MissionsPage'
import ModelHistoryPage from './pages/ModelHistoryPage'
import OverviewPage from './pages/OverviewPage'
import ReconciliationPage from './pages/ReconciliationPage'
import SettingsPage from './pages/SettingsPage'
import SimulationPage from './pages/SimulationPage'
import ValidationPage from './pages/ValidationPage'

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Navigate to="/overview" replace />} />
        <Route path="/overview" element={<OverviewPage />} />
        <Route path="/live" element={<LiveTwinPage />} />
        <Route path="/live/:id" element={<LiveTwinPage />} />
        <Route path="/components" element={<ComponentsPage />} />
        <Route path="/components/:id" element={<ComponentDetailPage />} />
        <Route path="/flights" element={<FlightsPage />} />
        <Route path="/predictions" element={<PredictionsPage />} />
        <Route path="/missions" element={<MissionsPage />} />
        <Route path="/simulation" element={<SimulationPage />} />
        <Route path="/reconciliation" element={<ReconciliationPage />} />
        <Route path="/inspections" element={<InspectionsPage />} />
        <Route path="/model-history" element={<ModelHistoryPage />} />
        <Route path="/validation" element={<ValidationPage />} />
        <Route path="/reliability" element={<ReliabilityPage />} />
        <Route path="/maintenance-intelligence" element={<MaintenanceIntelligencePage />} />
        <Route path="/methodology" element={<MethodologyPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/overview" replace />} />
      </Route>
    </Routes>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  )
}
