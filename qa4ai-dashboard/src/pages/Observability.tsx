import { Link } from 'react-router-dom'
import { useFilters } from '../store/filters'
import { useTraceMetrics } from '../api/prometheus'
import KpiCard from '../components/common/KpiCard'
import LoadingSkeleton from '../components/common/LoadingSkeleton'
import EmptyState from '../components/common/EmptyState'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid,
} from 'recharts'

const TOOLTIP_STYLE = {
  contentStyle: { background: '#ffffff', border: '1px solid #d0d7de', borderRadius: 6 },
  labelStyle: { color: '#24292f' },
}

export default function Observability() {
  const { project } = useFilters()
  const { traces, isLoading } = useTraceMetrics(project)

  const totalTraces  = traces.reduce((s, t) => s + t.count, 0)
  const avgLatP50    = traces.length ? traces.reduce((s, t) => s + t.latency_p50, 0) / traces.length : 0
  const avgLatP99    = traces.length ? traces.reduce((s, t) => s + t.latency_p99, 0) / traces.length : 0
  const totalTokens  = traces.reduce((s, t) => s + t.tokens_input + t.tokens_output, 0)

  const tracesByProject  = [...traces].sort((a, b) => b.count        - a.count)
  const latencyByProject = [...traces].sort((a, b) => b.latency_p99  - a.latency_p99)

  return (
    <div className="p-5 flex flex-col gap-5">
      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard label="Total Traces"    value={totalTraces.toFixed(0)}  color="accent" />
        <KpiCard label="Avg Latency p50" value={`${avgLatP50.toFixed(0)} ms`} color={avgLatP50 < 1000 ? 'success' : 'warning'} />
        <KpiCard label="Avg Latency p99" value={`${avgLatP99.toFixed(0)} ms`} color={avgLatP99 < 3000 ? 'success' : 'danger'} />
        <KpiCard label="Total Tokens"    value={totalTokens > 1e6 ? `${(totalTokens / 1e6).toFixed(1)}M` : totalTokens.toFixed(0)} color="default" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Trace count chart */}
        <div className="card flex flex-col gap-3">
          <div className="text-xs text-fg-muted font-medium">Trace Count by Project</div>
          {isLoading ? <LoadingSkeleton rows={4} /> : traces.length === 0 ? (
            <EmptyState message="No trace data" sub="Phoenix tracing not detected" />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart
                data={tracesByProject.slice(0, 10).map((t) => ({ name: t.project.slice(0, 14), count: t.count }))}
                margin={{ left: 0, right: 8 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#e1e4e8" vertical={false} />
                <XAxis dataKey="name" tick={{ fill: '#57606a', fontSize: 10 }} />
                <YAxis tick={{ fill: '#57606a', fontSize: 10 }} />
                <Tooltip {...TOOLTIP_STYLE} formatter={(v: number) => [v.toFixed(0), 'Traces']} />
                <Bar dataKey="count" fill="#0969da" radius={[4, 4, 0, 0]} maxBarSize={28} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Latency chart */}
        <div className="card flex flex-col gap-3">
          <div className="text-xs text-fg-muted font-medium">Latency p50 / p99 by Project (ms)</div>
          {isLoading ? <LoadingSkeleton rows={4} /> : traces.length === 0 ? (
            <EmptyState message="No latency data" />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart
                data={latencyByProject.slice(0, 10).map((t) => ({
                  name: t.project.slice(0, 12),
                  p50: t.latency_p50,
                  p99: t.latency_p99,
                }))}
                margin={{ left: 0, right: 8 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#e1e4e8" vertical={false} />
                <XAxis dataKey="name" tick={{ fill: '#57606a', fontSize: 10 }} />
                <YAxis tick={{ fill: '#57606a', fontSize: 10 }} tickFormatter={(v) => `${v}ms`} />
                <Tooltip {...TOOLTIP_STYLE} formatter={(v: number) => [`${v.toFixed(0)} ms`]} />
                <Bar dataKey="p50" fill="#3fb950" radius={[4, 4, 0, 0]} maxBarSize={14} name="p50" />
                <Bar dataKey="p99" fill="#f85149" radius={[4, 4, 0, 0]} maxBarSize={14} name="p99" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Project registry table */}
      <div className="card">
        <div className="text-xs text-fg-muted font-medium mb-3">Project Registry</div>
        {isLoading ? <LoadingSkeleton rows={5} height="h-7" /> : traces.length === 0 ? (
          <EmptyState message="No projects found" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-fg-subtle">
                  <th className="text-left py-2 pr-4 font-medium">Project</th>
                  <th className="text-right py-2 pr-4 font-medium">Traces</th>
                  <th className="text-right py-2 pr-4 font-medium">p50 (ms)</th>
                  <th className="text-right py-2 pr-4 font-medium">p99 (ms)</th>
                  <th className="text-right py-2 font-medium">Tokens</th>
                </tr>
              </thead>
              <tbody>
                {tracesByProject.map((t) => (
                  <tr key={t.project} className="border-b border-border/50 hover:bg-canvas-subtle">
                    <td className="py-1.5 pr-4">
                      <Link to={`/project/${encodeURIComponent(t.project)}`} className="text-accent hover:underline">
                        {t.project}
                      </Link>
                    </td>
                    <td className="py-1.5 pr-4 text-right tabular-nums text-fg">{t.count.toFixed(0)}</td>
                    <td className="py-1.5 pr-4 text-right tabular-nums text-fg-muted">{t.latency_p50.toFixed(0)}</td>
                    <td className="py-1.5 pr-4 text-right tabular-nums" style={{ color: t.latency_p99 > 3000 ? '#cf222e' : '#57606a' }}>
                      {t.latency_p99.toFixed(0)}
                    </td>
                    <td className="py-1.5 text-right tabular-nums text-fg-subtle">
                      {((t.tokens_input + t.tokens_output) / 1000).toFixed(1)}K
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
