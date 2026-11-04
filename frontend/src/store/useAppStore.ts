import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Mission } from '../api/types'

export interface Toast {
  id: number
  kind: 'info' | 'success' | 'error' | 'warning'
  message: string
}

interface AppState {
  selectedComponentId: string
  setSelectedComponentId: (id: string) => void
  draftMissions: Mission[]
  setDraftMissions: (m: Mission[]) => void
  lastRunId: string | null
  setLastRunId: (id: string | null) => void
  lastReconciliationId: string | null
  setLastReconciliationId: (id: string | null) => void
  lastPredictionId: string | null
  setLastPredictionId: (id: string | null) => void
  toasts: Toast[]
  pushToast: (kind: Toast['kind'], message: string) => void
  dismissToast: (id: number) => void
  refreshKey: number
  bump: () => void
}

let toastSeq = 1

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      selectedComponentId: 'ENG-MOUNT-001',
      setSelectedComponentId: (id) => set({ selectedComponentId: id }),
      draftMissions: [{ profile: 'normal' }, { profile: 'increased_load' }, { profile: 'normal' }],
      setDraftMissions: (draftMissions) => set({ draftMissions }),
      lastRunId: null,
      setLastRunId: (lastRunId) => set({ lastRunId }),
      lastReconciliationId: null,
      setLastReconciliationId: (lastReconciliationId) => set({ lastReconciliationId }),
      lastPredictionId: null,
      setLastPredictionId: (lastPredictionId) => set({ lastPredictionId }),
      toasts: [],
      pushToast: (kind, message) => {
        const id = toastSeq++
        set((s) => ({ toasts: [...s.toasts, { id, kind, message }] }))
        setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), kind === 'error' ? 9000 : 5000)
      },
      dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
      refreshKey: 0,
      bump: () => set((s) => ({ refreshKey: s.refreshKey + 1 })),
    }),
    { name: 'aerosim-ui-v2', partialize: (s) => ({ selectedComponentId: s.selectedComponentId, draftMissions: s.draftMissions, lastRunId: s.lastRunId, lastReconciliationId: s.lastReconciliationId, lastPredictionId: s.lastPredictionId }) },
  ),
)
