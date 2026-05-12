import { useFilters } from '../../store/filters'
import { useProjectNames } from '../../api/prometheus'
import { useQueryClient } from '@tanstack/react-query'

const REFRESH_OPTIONS = [
  { label: 'Off',   value: 0 },
  { label: '15 s',  value: 15_000 },
  { label: '30 s',  value: 30_000 },
  { label: '1 min', value: 60_000 },
  { label: '5 min', value: 300_000 },
]

export default function FilterBar() {
  const { project, refresh, setProject, setRefresh } = useFilters()
  const { data: projects = [] } = useProjectNames()
  const qc = useQueryClient()

  return (
    <div className="flex items-center gap-3 px-4 py-2 bg-canvas-overlay border-b border-border flex-wrap">
      {/* Agentic App filter */}
      <div className="flex items-center gap-1.5">
        <span className="text-fg-subtle text-xs font-medium">Agentic App</span>
        <select
          className="select"
          value={project}
          onChange={(e) => setProject(e.target.value)}
        >
          <option value=".*">All apps</option>
          {projects.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
      </div>

      {/* Auto-refresh */}
      <div className="flex items-center gap-1.5 ml-auto">
        <span className="text-fg-subtle text-xs">Refresh</span>
        <select
          className="select"
          value={refresh}
          onChange={(e) => setRefresh(Number(e.target.value))}
        >
          {REFRESH_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>

        <button
          className="btn"
          onClick={() => qc.invalidateQueries({ queryKey: ['prom'] })}
          title="Refresh all metrics now"
        >
          ↻ Refresh
        </button>
      </div>
    </div>
  )
}
