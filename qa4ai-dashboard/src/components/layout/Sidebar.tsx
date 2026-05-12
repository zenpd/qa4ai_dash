import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import RecommendationsPane from '../recommendations/RecommendationsPane'

const NAV = [
  { path: '/',               label: 'Overview',        icon: '⬡' },
  { path: '/correctness',    label: 'Correctness',     icon: '✓' },
  { path: '/reliability',    label: 'Reliability',     icon: '◎' },
  { path: '/observability',  label: 'Observability',   icon: '◈' },
  { path: '/governance',     label: 'Governance',      icon: '⬗' },
  { path: '/infrastructure', label: 'Infrastructure',  icon: '⬙' },
  { path: '/security',       label: 'Security',        icon: '🛡' },
] as const

export default function Sidebar() {
  const { pathname } = useLocation()
  const [showRecs, setShowRecs] = useState(false)

  return (
    <aside
      className="flex-shrink-0 bg-canvas-overlay border-r border-border flex flex-col py-3 gap-1 transition-all duration-200"
      style={{ width: showRecs ? '320px' : '208px' }}
    >
      {showRecs ? (
        <RecommendationsPane onClose={() => setShowRecs(false)} />
      ) : (
        <>
          <div className="px-4 mb-3">
            <div className="flex items-baseline gap-1.5">
              <div className="text-accent font-medium text-sm tracking-wide">QE4AI</div>
              <div className="text-xs font-medium px-1 py-0.5 rounded" style={{ background: '#0969da15', color: '#0969da' }}>[ZenLabs]</div>
            </div>
            <div className="text-fg-subtle text-xs mt-0.5">Quality Engineering</div>
          </div>

          <nav className="flex flex-col gap-0.5 px-2 flex-1">
            {NAV.map(({ path, label, icon }) => {
              const active = path === '/' ? pathname === '/' : pathname.startsWith(path)
              return (
                <Link key={path} to={path} className={`nav-link ${active ? 'active' : ''}`}>
                  <span className="w-4 text-center opacity-70">{icon}</span>
                  <span>{label}</span>
                </Link>
              )
            })}
          </nav>

          {/* Recommendations button */}
          <div className="px-2">
            <button
              className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-xs font-medium transition-colors"
              style={{ background: '#fff8e1', color: '#9a6700', border: '1px solid #f0d070' }}
              onClick={() => setShowRecs(true)}
            >
              <span>💡</span>
              <span>Recommendations</span>
            </button>
          </div>

          <div className="px-4 py-2 border-t border-border mt-2">
            <a
              href="https://unified-dash-grafana.bravesky-d9f9eeb7.eastus2.azurecontainerapps.io"
              target="_blank"
              rel="noreferrer"
              className="text-fg-subtle text-xs hover:text-accent transition-colors"
            >
              ↗ Grafana Dashboards
            </a>
          </div>
        </>
      )}
    </aside>
  )
}

