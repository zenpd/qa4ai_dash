import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useFilters } from '../store/filters'
import {
  useEvaluatorScores,
  useTraceMetrics,
  pct,
  scoreColor,
} from '../api/prometheus'
import KpiCard from '../components/common/KpiCard'
import EvalBar from '../components/common/EvalBar'
import LoadingSkeleton from '../components/common/LoadingSkeleton'
import EmptyState from '../components/common/EmptyState'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ReferenceLine,
  ResponsiveContainer, Cell, CartesianGrid,
} from 'recharts'

// Derive synthetic evaluator scores from trace metrics when phoenix_evaluator_score is empty
function deriveScoresFromTraces(traces: ReturnType<typeof useTraceMetrics>['traces']) {
  return traces.map((t) => {
    // Latency quality: p99 < 2000ms = 1.0, p99 > 10000ms = 0.0
    const latScore = t.latency_p99 > 0
      ? Math.max(0, Math.min(1, 1 - (t.latency_p99 - 2000) / 8000))
      : null
    // Token efficiency: lower completion/prompt ratio = better efficiency proxy (capped)
    const tokScore = t.tokens_input > 0 && t.tokens_input > 0
      ? Math.max(0, Math.min(1, 0.5 + Math.log10(Math.max(1, t.tokens_input)) / 20))
      : null
    return { project: t.project, latency_quality: latScore, token_efficiency: tokScore }
  })
}

export default function Correctness() {
  const { project } = useFilters()
  const [sort, setSort] = useState<'score' | 'name'>('score')

  const { scores, isLoading, isError } = useEvaluatorScores(project)
  const { traces, isLoading: trLoading } = useTraceMetrics(project)

  const hasRealScores = scores.length > 0

  // Derive synthetic scores from trace metrics as fallback
  const derived = deriveScoresFromTraces(traces)

  // Build chart data — real evaluator scores OR derived latency/token scores
  type ChartEntry = { name: string; score: number; threshold: number; synthetic?: boolean }
  let chartData: ChartEntry[] = []

  if (hasRealScores) {
    const evalMap = new Map<string, { score: number; count: number; threshold: number }>()
    scores.forEach((s) => {
      const cur = evalMap.get(s.name)
      if (cur) { cur.score += s.score; cur.count++ }
      else evalMap.set(s.name, { score: s.score, count: 1, threshold: s.threshold })
    })
    chartData = [...evalMap.entries()]
      .map(([name, v]) => ({ name: name.replace(/_/g, ' '), score: (v.score / v.count) * 100, threshold: v.threshold * 100 }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 12)
  } else {
    // Synthetic from trace metrics: latency quality per project
    chartData = derived
      .filter((d) => d.latency_quality !== null)
      .map((d) => ({ name: d.project.slice(0, 20), score: (d.latency_quality ?? 0) * 100, threshold: 65, synthetic: true }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 12)
  }

  // KPI values
  const avgScore = hasRealScores
    ? scores.reduce((s, e) => s + e.score, 0) / scores.length
    : derived.filter(d => d.latency_quality !== null).reduce((s, d) => s + (d.latency_quality ?? 0), 0) / Math.max(1, derived.filter(d => d.latency_quality !== null).length)

  const threshold = hasRealScores ? 0.75 : 0.65
  const passingCount = hasRealScores
    ? scores.filter((s) => s.score >= s.threshold).length
    : derived.filter(d => (d.latency_quality ?? 0) >= threshold).length
  const totalCount = hasRealScores ? scores.length : derived.filter(d => d.latency_quality !== null).length
  const gateRate = totalCount > 0 ? passingCount / totalCount : 0

  const sorted = hasRealScores
    ? [...scores].sort((a, b) => sort === 'score' ? b.score - a.score : a.name.localeCompare(b.name))
    : []

  const loading = isLoading || trLoading

  return (
    <div className="p-5 flex flex-col gap-5">
      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard
          label="Avg QE Score"
          value={pct(avgScore)}
          color={avgScore >= 0.75 ? 'success' : avgScore >= 0.55 ? 'warning' : 'danger'}
          sub={hasRealScores ? 'response_quality evaluator' : 'latency quality (derived)'}
        />
        <KpiCard
          label="CI Gate Pass Rate"
          value={pct(gateRate)}
          color={gateRate >= 0.8 ? 'success' : 'warning'}
        />
        <KpiCard
          label="Passing"
          value={passingCount}
          color="success"
          sub={`of ${totalCount} total`}
        />
        <KpiCard
          label="Failing"
          value={totalCount - passingCount}
          color={(totalCount - passingCount) > 0 ? 'danger' : 'success'}
          sub="below threshold"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Bar chart */}
        <div className="card flex flex-col gap-3">
          <div className="text-xs text-fg-muted font-medium">
            {hasRealScores ? 'Evaluator Scores (avg across projects)' : 'Latency Quality by Project (derived)'}
          </div>
          {loading ? (
            <LoadingSkeleton rows={6} height="h-5" />
          ) : chartData.length === 0 ? (
            <EmptyState message="No trace data" sub="Check Phoenix connectivity" />
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(200, chartData.length * 28)}>
              <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 40, top: 4, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e1e4e8" horizontal={false} />
                <XAxis type="number" domain={[0, 100]} tickFormatter={(v) => `${v}%`}
                  tick={{ fill: '#57606a', fontSize: 10 }} />
                <YAxis
                  type="category" dataKey="name" width={160}
                  tick={{ fill: '#57606a', fontSize: 10 }}
                  tickFormatter={(v: string) => v.length > 22 ? v.slice(0, 20) + '…' : v}
                />
                <Tooltip
                  contentStyle={{ background: '#ffffff', border: '1px solid #d0d7de', borderRadius: 6 }}
                  labelStyle={{ color: '#24292f' }}
                  formatter={(v: number) => [`${v.toFixed(1)}%`, hasRealScores ? 'Score' : 'Latency Quality']}
                />
                <ReferenceLine x={hasRealScores ? 75 : 65} stroke="#57606a" strokeDasharray="4 2" />
                <Bar dataKey="score" radius={[0, 4, 4, 0]} maxBarSize={16}>
                  {chartData.map((entry) => (
                    <Cell key={entry.name} fill={scoreColor(entry.score / 100)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Evaluator list or trace list */}
        <div className="card flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <div className="text-xs text-fg-muted font-medium">
              {hasRealScores ? 'All Evaluators' : 'Project Latency Quality'}
            </div>
            {hasRealScores && (
              <div className="flex gap-1">
                <button className={`btn text-xs ${sort === 'score' ? 'btn-accent' : ''}`} onClick={() => setSort('score')}>Score</button>
                <button className={`btn text-xs ${sort === 'name'  ? 'btn-accent' : ''}`} onClick={() => setSort('name')}>Name</button>
              </div>
            )}
          </div>
          <div className="flex flex-col overflow-y-auto max-h-96">
            {loading && <LoadingSkeleton rows={6} />}
            {isError && <EmptyState message="Failed to load evaluators" sub="Check Prometheus" />}
            {!loading && hasRealScores && sorted.length === 0 && <EmptyState message="No evaluator metrics found" />}
            {hasRealScores && sorted.map((s) => (
              <Link key={`${s.name}-${s.project}`} to={`/evaluator/${encodeURIComponent(s.name)}`}>
                <EvalBar name={`${s.label} (${s.project})`} score={s.score} threshold={s.threshold} onClick={() => {}} />
              </Link>
            ))}
            {!hasRealScores && !loading && chartData.map((entry) => (
              <EvalBar
                key={entry.name}
                name={entry.name}
                score={entry.score / 100}
                threshold={entry.threshold / 100}
              />
            ))}
          </div>
        </div>
      </div>

      {/* CI Gate table — only shown when real evaluator data exists */}
      {hasRealScores && (
        <div className="card">
          <div className="text-xs text-fg-muted font-medium mb-3">CI Gate Summary — Pass/Fail per Evaluator</div>
          {loading ? (
            <LoadingSkeleton rows={4} height="h-7" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border text-fg-subtle">
                    <th className="text-left py-2 pr-4 font-medium">Evaluator</th>
                    <th className="text-left py-2 pr-4 font-medium">Project</th>
                    <th className="text-right py-2 pr-4 font-medium">Score</th>
                    <th className="text-right py-2 pr-4 font-medium">Threshold</th>
                    <th className="text-right py-2 font-medium">Gate</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((s, i) => (
                    <tr key={i} className="border-b border-border/50 hover:bg-canvas-subtle">
                      <td className="py-1.5 pr-4 text-fg">{s.label}</td>
                      <td className="py-1.5 pr-4 text-fg-muted">
                        <Link to={`/project/${encodeURIComponent(s.project)}`} className="hover:text-accent">
                          {s.project}
                        </Link>
                      </td>
                      <td className="py-1.5 pr-4 text-right tabular-nums" style={{ color: scoreColor(s.score) }}>
                        {pct(s.score)}
                      </td>
                      <td className="py-1.5 pr-4 text-right tabular-nums text-fg-subtle">
                        {pct(s.threshold)}
                      </td>
                      <td className="py-1.5 text-right">
                        <span className={`pill ${s.score >= s.threshold ? 'pill-success' : 'pill-danger'}`}>
                          {s.score >= s.threshold ? '● PASS' : '● FAIL'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Trace-based quality table — shown when no evaluator scores */}
      {!hasRealScores && !loading && traces.length > 0 && (
        <div className="card">
          <div className="text-xs text-fg-muted font-medium mb-3">Project Quality from Trace Metrics</div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-fg-subtle">
                  <th className="text-left py-2 pr-4 font-medium">Project</th>
                  <th className="text-right py-2 pr-4 font-medium">Traces</th>
                  <th className="text-right py-2 pr-4 font-medium">Latency p50</th>
                  <th className="text-right py-2 pr-4 font-medium">Latency p99</th>
                  <th className="text-right py-2 pr-4 font-medium">Tokens</th>
                  <th className="text-right py-2 font-medium">Lat. Quality</th>
                </tr>
              </thead>
              <tbody>
                {[...traces].sort((a, b) => b.count - a.count).map((t) => {
                  const latQ = t.latency_p99 > 0 ? Math.max(0, Math.min(1, 1 - (t.latency_p99 - 2000) / 8000)) : null
                  return (
                    <tr key={t.project} className="border-b border-border/50 hover:bg-canvas-subtle">
                      <td className="py-1.5 pr-4 text-fg">
                        <Link to={`/project/${encodeURIComponent(t.project)}`} className="hover:text-accent">{t.project}</Link>
                      </td>
                      <td className="py-1.5 pr-4 text-right text-fg-subtle">{t.count.toFixed(0)}</td>
                      <td className="py-1.5 pr-4 text-right text-fg-subtle">{t.latency_p50.toFixed(0)} ms</td>
                      <td className="py-1.5 pr-4 text-right" style={{ color: t.latency_p99 > 5000 ? '#f85149' : t.latency_p99 > 3000 ? '#d29922' : '#8b949e' }}>
                        {t.latency_p99.toFixed(0)} ms
                      </td>
                      <td className="py-1.5 pr-4 text-right text-fg-subtle">{t.tokens_input > 0 ? t.tokens_input.toFixed(0) : '—'}</td>
                      <td className="py-1.5 text-right">
                        {latQ !== null ? (
                          <span style={{ color: scoreColor(latQ) }}>{pct(latQ)}</span>
                        ) : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
