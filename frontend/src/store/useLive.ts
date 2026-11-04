import { useEffect } from 'react'
import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import { api } from '../api/client'
import type { LiveSnapshot } from '../api/types'

interface LiveState {
  snapshot: LiveSnapshot | null
  online: boolean | null
  lastChange: number
  subscribers: number
  setSnapshot: (s: LiveSnapshot) => void
  setOnline: (b: boolean) => void
  subscribe: () => () => void
}

function fingerprint(s: LiveSnapshot): string {
  return JSON.stringify([s.counts, s.components.map((c) => [c.id, c.model_version, c.state]), s.flights.map((f) => f.status), s.activity[0]?.id])
}

let timer: ReturnType<typeof setInterval> | null = null

export const useLive = create<LiveState>()((set, get) => ({
  snapshot: null,
  online: null,
  lastChange: 0,
  subscribers: 0,
  setSnapshot: (snapshot) => {
    const prev = get().snapshot
    const changed = !prev || fingerprint(prev) !== fingerprint(snapshot)
    set({ snapshot, online: true, lastChange: changed ? Date.now() : get().lastChange })
  },
  setOnline: (online) => set({ online }),
  subscribe: () => {
    const poll = () => api.live().then(get().setSnapshot).catch(() => get().setOnline(false))
    set((s) => ({ subscribers: s.subscribers + 1 }))
    if (!timer) {
      poll()
      timer = setInterval(poll, 2500)
    }
    return () => {
      set((s) => ({ subscribers: s.subscribers - 1 }))
      if (get().subscribers <= 0 && timer) {
        clearInterval(timer)
        timer = null
      }
    }
  },
}))

/** Mount once per page that should react to backend changes; `lastChange` bumps when anything moved. */
export function useLiveFeed() {
  const subscribe = useLive((s) => s.subscribe)
  useEffect(() => subscribe(), [subscribe])
  return useLive(useShallow((s) => ({ snapshot: s.snapshot, online: s.online, lastChange: s.lastChange })))
}

export function useLiveChange() {
  return useLive((s) => s.lastChange)
}
