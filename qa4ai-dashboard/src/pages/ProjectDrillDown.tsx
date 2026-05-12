import { useParams, Link } from 'react-router-dom'
import {
  useEvaluatorScores,
  useTraceMetrics,
  useWorkflowStats,
  pct,
} from '../api/prometheus'
import KpiCard from '../components/common/KpiCard'
import EvalBar from '../components/common/EvalBar'
import StatRow from '../components/common/StatRow'
import LoadingSkeleton from '../components/common/LoadingSkeleton'
import EmptyState from '../components/common/EmptyState'

export default function ProjectDrillDown() {
  const { name = '' } = useParams<{ name: string }>()
  const projectName   = decodeURIComponent(name)
  const { scores, isLoading: scLoading }  = useEvaluatorScores(projectName)
  const { traces, isLoading: trLoading }  = useTraceMetrics(projectName)
  const { stats,  isLoading: wfLoading }  = useWorkflowStats()

  const projectTrace = traces.find((t) => t.project === projectName)
  const avgScore     = scores.length ? scores.reduce((s, e) => s + e.score, 0) / scores.length : 0
  const passing      = scores.filter((s) => s.score >= s.threshold).length

  return (
    <div className="p-5 flex flex-col gap-5">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-xs text-fg-subtle">
        <Link to="/" className="hover:text-accent">Overview</Link>
        <span>›</span>
        <Link to="/correctness" className="hover:text-accent">Projects</Link>
        <span>›</span>
        <span className="text-fg">{projectName}</span>
      </div>

      <div className="flex items-center gap-3">
        <h2 className="text-lg font-semibold text-fg">{projectName}</h2>
        <span className="pill pill-accent">Project</span>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard
          label="Avg QE Score"
          value={pct(avgScore)}
          color={avgScore >= 0.85 ? 'success' : avgScore >= 0.7 ? 'warning' : 'danger'}
        />
        <KpiCard
          label="Evaluators"
          value={scores.length}
          sub={`${passing} passing`}
          color="accent"
        />
        <KpiCard
          label="Total Traces"
          value={(projectTrace?.count ?? 0).toFixed(0)}
          color="default"
        />
        <KpiCard
          label="Latency p99"
          value={`${(projectTrace?.latency_p99 ?? 0).toFixed(0)} ms`}
          color={(projectTrace?.latency_p99 ?? 0) > 3000 ? 'danger' : 'success'}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Evaluator scores */}
        <div className="card flex flex-col gap-3">
          <div className="text-xs text-fg-muted font-medium">Evaluator Scores</div>
          {scLoading ? (
            <LoadingSkeleton rows={5} />
          ) : scores.length === 0 ? (
            <EmptyState message="No evaluators for this project" />
          ) : (
            <div className="flex flex-col">
              {scores
                .sort((a, b) => b.score - a.score)
                .map((s) => (
                  <Link key={s.name} to={`/evaluator/${encodeURIComponent(s.name)}`}>
                    <EvalBar name={s.label} score={s.score} threshold={s.threshold} onClick={() => {}} />
                  </Link>
                ))}
            </div>
          )}
        </div>

        {/* Trace metrics */}
        <div className="card flex flex-col gap-3">
          <div className="text-xs text-fg-muted font-medium">Trace Details</div>
          {trLoading ? (
            <LoadingSkeleton rows={5} />
          ) : !projectTrace ? (
            <EmptyState message="No trace data for this project" />
          ) : (
            <>
              <StatRow label="Total Traces"   value={projectTrace.count.toFixed(0)} />
              <StatRow label="Latency p50"    value={`${projectTrace.latency_p50.toFixed(0)} ms`}  color={projectTrace.latency_p50 < 1000 ? '#3fb950' : '#d29922'} />
              <StatRow label="Latency p99"    value={`${projectTrace.latency_p99.toFixed(0)} ms`}  color={projectTrace.latency_p99 < 3000 ? '#3fb950' : '#f85149'} />
              <StatRow label="Tokens (input)" value={`${(projectTrace.tokens_input / 1000).toFixed(1)}K`} />
            </>
          )}

          <div className="mt-3 pt-3 border-t border-border">
            <div className="text-xs text-fg-muted font-medium mb-2">Temporal Workflows</div>
            {wfLoading ? (
              <LoadingSkeleton rows={3} height="h-6" />
            ) : stats.length === 0 ? (
              <EmptyState message="No workflow data" />
            ) : (
              stats.map((s) => (
                <StatRow key={s.namespace} label={s.namespace} value={`${s.active} active / ${s.completed} done`} />
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
