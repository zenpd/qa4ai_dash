import { useLocation } from 'react-router-dom'
import FilterBar from './FilterBar'

const TITLES: Record<string, string> = {
  '/':              'Overview',
  '/correctness':   'Correctness',
  '/reliability':   'Reliability',
  '/observability': 'Observability',
  '/governance':    'Governance',
}

export default function TopBar() {
  const { pathname } = useLocation()

  const base = '/' + pathname.split('/')[1]
  const title = TITLES[base] ?? pathname.split('/').pop()?.replace(/-/g, ' ') ?? 'QE4AI'

  return (
    <header className="flex flex-col border-b border-border">
      <div className="flex items-center justify-between px-4 py-2.5 bg-canvas-overlay">
        <h1 className="text-fg font-semibold text-sm capitalize">{title}</h1>
        <div className="flex items-center gap-2 text-xs text-fg-subtle">
          <span className="w-2 h-2 rounded-full bg-success animate-pulse" />
          Live
        </div>
      </div>
      <FilterBar />
    </header>
  )
}
