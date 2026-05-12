import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface FilterState {
  project:   string
  namespace: string
  refresh:   number   // auto-refresh interval in ms; 0 = off
  setProject:   (p: string) => void
  setNamespace: (n: string) => void
  setRefresh:   (r: number) => void
}

export const useFilters = create<FilterState>()(
  persist(
    (set) => ({
      project:   '.*',
      namespace: '.*',
      refresh:   30_000,
      setProject:   (project)   => set({ project }),
      setNamespace: (namespace) => set({ namespace }),
      setRefresh:   (refresh)   => set({ refresh }),
    }),
    { name: 'qe4ai-filters' }
  )
)
