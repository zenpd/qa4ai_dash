import React, { Suspense } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'

import Sidebar from './components/layout/Sidebar'
import TopBar  from './components/layout/TopBar'
import LoadingSkeleton from './components/common/LoadingSkeleton'
import { useFilters } from './store/filters'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'

// Page-level code splitting — each page is a separate chunk
const Overview         = React.lazy(() => import('./pages/Overview'))
const Correctness      = React.lazy(() => import('./pages/Correctness'))
const Reliability      = React.lazy(() => import('./pages/Reliability'))
const Observability    = React.lazy(() => import('./pages/Observability'))
const Governance       = React.lazy(() => import('./pages/Governance'))
const Infrastructure   = React.lazy(() => import('./pages/Infrastructure'))
const ProjectDrillDown = React.lazy(() => import('./pages/ProjectDrillDown'))
const EvaluatorDetail  = React.lazy(() => import('./pages/EvaluatorDetail'))
const Security         = React.lazy(() => import('./pages/Security'))

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 25_000,
      gcTime:    5 * 60_000,
      retry: 2,
      refetchOnWindowFocus: false,
    },
  },
})

function PageSuspense({ children }: { children: React.ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="p-6">
          <LoadingSkeleton rows={8} height="h-10" />
        </div>
      }
    >
      {children}
    </Suspense>
  )
}

// Auto-refresh: invalidate all prom queries on interval
function AutoRefresher() {
  const qc = useQueryClient()
  const { refresh } = useFilters()

  useEffect(() => {
    if (!refresh) return
    const id = setInterval(() => {
      qc.invalidateQueries({ queryKey: ['prom'] })
    }, refresh)
    return () => clearInterval(id)
  }, [qc, refresh])

  return null
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <div className="flex h-screen overflow-hidden">
          <Sidebar />

          <div className="flex-1 flex flex-col overflow-hidden">
            <TopBar />
            <AutoRefresher />

            <main className="flex-1 overflow-y-auto">
              <Routes>
                <Route path="/" element={<PageSuspense><Overview /></PageSuspense>} />
                <Route path="/correctness"      element={<PageSuspense><Correctness /></PageSuspense>} />
                <Route path="/reliability"      element={<PageSuspense><Reliability /></PageSuspense>} />
                <Route path="/observability"    element={<PageSuspense><Observability /></PageSuspense>} />
                <Route path="/governance"       element={<PageSuspense><Governance /></PageSuspense>} />
                <Route path="/infrastructure"   element={<PageSuspense><Infrastructure /></PageSuspense>} />
                <Route path="/security"         element={<PageSuspense><Security /></PageSuspense>} />
                <Route path="/project/:name"    element={<PageSuspense><ProjectDrillDown /></PageSuspense>} />
                <Route path="/evaluator/:name"  element={<PageSuspense><EvaluatorDetail /></PageSuspense>} />
              </Routes>
            </main>
          </div>
        </div>
      </BrowserRouter>

      {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} />}
    </QueryClientProvider>
  )
}
