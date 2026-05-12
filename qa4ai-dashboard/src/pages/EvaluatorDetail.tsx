import { useParams, Link } from 'react-router-dom'
import { useEvaluatorScores, pct, scoreColor } from '../api/prometheus'
import EvalBar from '../components/common/EvalBar'
import KpiCard from '../components/common/KpiCard'
import LoadingSkeleton from '../components/common/LoadingSkeleton'
import EmptyState from '../components/common/EmptyState'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Cell, ReferenceLine,
} from 'recharts'

export default function EvaluatorDetail() {
  const { name = '' } = useParams<{ name: string }>()
  const evalName = decodeURIComponent(name)
  // Load all evaluator scores for this evaluator name across all projects
  const { scores, isLoading } = useEvaluatorScores('.*')
  const filtered = scores.filter((s) => s.name === evalName)

  const avgScore = filtered.length ? filtered.reduce((s, e) => s + e.score, 0) / filtered.length : 0
  const passing  = filtered.filter((s) => s.score >= s.threshold).length
  const failing  = filtered.length - passing

  const chartData = filtered
    .sort((a, b) => b.score - a.score)
    .map((s) => ({ name: s.project.slice(0, 16), score: s.score * 100, threshold: s.threshold * 100 }))

  return (
    <div className="p-5 flex flex-col gap-5">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-xs text-fg-subtle">
        <Link to="/" className="hover:text-accent">Overview</Link>
        <span>›</span>
        <Link to="/correctness" className="hover:text-accent">Correctness</Link>
        <span>›</span>
        <span className="text-fg">{evalName.replace(/_/g, ' ')}</span>
      </div>

      <div className="flex items-center gap-3">
        <h2 className="text-lg font-semibold text-fg capitalize">{evalName.replace(/_/g, ' ')}</h2>
        <span className="pill pill-accent">Evaluator</span>
        <span className={`pill ${avgScore >= 0.85 ? 'pill-success' : avgScore >= 0.7 ? 'pill-warning' : 'pill-danger'}`}>
          avg {pct(avgScore)}
        </span>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard label="Avg Score"       value={pct(avgScore)}   color={avgScore >= 0.85 ? 'success' : avgScore >= 0.7 ? 'warning' : 'danger'} />
        <KpiCard label="Projects Using"  value={filtered.length} color="accent" />
        <KpiCard label="Passing"         value={passing}         color="success" sub={`of ${filtered.length}`} />
        <KpiCard label="Failing"         value={failing}         color={failing > 0 ? 'danger' : 'success'} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Score by project (bars) */}
        <div className="card flex flex-col gap-3">
          <div className="text-xs text-fg-muted font-medium">Score by Project</div>
          {isLoading ? (
            <LoadingSkeleton rows={4} />
          ) : chartData.length === 0 ? (
            <EmptyState message="No data for this evaluator" sub={`Evaluator "${evalName}" not found in Prometheus`} />
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(180, chartData.length * 34)}>
              <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 40 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e1e4e8" horizontal={false} />
                <XAxis type="number" domain={[0, 100]} tickFormatter={(v) => `${v}%`} tick={{ fill: '#57606a', fontSize: 10 }} />
                <YAxis type="category" dataKey="name" width={120} tick={{ fill: '#57606a', fontSize: 10 }} />
                <Tooltip
                  contentStyle={{ background: '#ffffff', border: '1px solid #d0d7de', borderRadius: 6 }}
                  labelStyle={{ color: '#24292f' }}
                  formatter={(v: number) => [`${v.toFixed(1)}%`, 'Score']}
                />
                <ReferenceLine x={85} stroke="#57606a" strokeDasharray="4 2" />
                <Bar dataKey="score" radius={[0, 4, 4, 0]} maxBarSize={18}>
                  {chartData.map((entry) => (
                    <Cell key={entry.name} fill={scoreColor(entry.score / 100)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Per-project detail list */}
        <div className="card flex flex-col gap-2">
          <div className="text-xs text-fg-muted font-medium">All Projects</div>
          {isLoading && <LoadingSkeleton rows={5} />}
          {!isLoading && filtered.length === 0 && (
            <EmptyState message="No evaluator results found" />
          )}
          <div className="flex flex-col overflow-y-auto max-h-96">
            {filtered.sort((a, b) => b.score - a.score).map((s) => (
              <div key={s.project} className="py-1.5 border-b border-border/50 last:border-0">
                <div className="flex items-center justify-between mb-1">
                  <Link to={`/project/${encodeURIComponent(s.project)}`} className="text-xs text-accent hover:underline">
                    {s.project}
                  </Link>
                  <span
                    className={`text-xs px-1.5 py-0.5 rounded ${s.score >= s.threshold ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger'}`}
                  >
                    {s.score >= s.threshold ? 'PASS' : 'FAIL'}
                  </span>
                </div>
                <EvalBar name={s.project} score={s.score} threshold={s.threshold} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
