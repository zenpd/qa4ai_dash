import {
  useWorkflowStats,
  useWorkflowCanceled,
  useActivityErrors,
  scalar,
} from '../api/prometheus'
import KpiCard from '../components/common/KpiCard'
import StatRow from '../components/common/StatRow'
import LoadingSkeleton from '../components/common/LoadingSkeleton'
import EmptyState from '../components/common/EmptyState'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Legend,
} from 'recharts'

export default function Reliability() {
  const { stats, isLoading, isError } = useWorkflowStats()
  const errors   = useActivityErrors()
  const canceled = useWorkflowCanceled()

  const totActive    = stats.reduce((s, r) => s + r.active,    0)
  const totCompleted = stats.reduce((s, r) => s + r.completed,  0)
  const totFailed    = stats.reduce((s, r) => s + r.failed,     0)
  const totTimedOut  = stats.reduce((s, r) => s + r.timed_out,  0)
  const totCanceled  = scalar(canceled.data ?? [])
  const errCount     = scalar(errors.data ?? [])

  const successRate = totCompleted + totFailed > 0
    ? totCompleted / (totCompleted + totFailed)
    : 0

  const chartData = stats.map((s) => ({
    name:      s.namespace.length > 14 ? s.namespace.slice(0, 12) + '…' : s.namespace,
    Active:    s.active,
    Completed: s.completed,
    Failed:    s.failed,
    'Timed Out': s.timed_out,
  }))

  return (
    <div className="p-5 flex flex-col gap-5">
      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
        <KpiCard label="Active Workflows"    value={totActive}       color="accent" />
        <KpiCard label="Completed"           value={totCompleted}    color="success" />
        <KpiCard
          label="Failed"
          value={totFailed}
          color={totFailed > 0 ? 'danger' : 'success'}
        />
        <KpiCard
          label="Timed Out"
          value={totTimedOut}
          color={totTimedOut > 0 ? 'warning' : 'success'}
        />
        <KpiCard
          label="Canceled"
          value={totCanceled}
          color={totCanceled > 0 ? 'warning' : 'success'}
        />
        <KpiCard
          label="Success Rate"
          value={`${(successRate * 100).toFixed(1)}%`}
          color={successRate >= 0.95 ? 'success' : successRate >= 0.85 ? 'warning' : 'danger'}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Workflow chart by Temporal namespace */}
        <div className="card flex flex-col gap-3">
          <div className="text-xs text-fg-muted font-medium">Workflows by Temporal Namespace</div>
          {isLoading ? (
            <LoadingSkeleton rows={5} />
          ) : chartData.length === 0 ? (
            <EmptyState message="No workflow data" sub="Check Temporal metrics in Prometheus" />
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={chartData} margin={{ left: 0, right: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e1e4e8" vertical={false} />
                <XAxis dataKey="name" tick={{ fill: '#57606a', fontSize: 10 }} />
                <YAxis tick={{ fill: '#57606a', fontSize: 10 }} />
                <Tooltip
                  contentStyle={{ background: '#ffffff', border: '1px solid #d0d7de', borderRadius: 6 }}
                  labelStyle={{ color: '#24292f' }}
                />
                <Legend wrapperStyle={{ fontSize: 10, color: '#57606a' }} />
                <Bar dataKey="Completed"   fill="#3fb950" radius={[4, 4, 0, 0]} maxBarSize={20} />
                <Bar dataKey="Active"      fill="#58a6ff" radius={[4, 4, 0, 0]} maxBarSize={20} />
                <Bar dataKey="Failed"      fill="#f85149" radius={[4, 4, 0, 0]} maxBarSize={20} />
                <Bar dataKey="Timed Out"   fill="#d29922" radius={[4, 4, 0, 0]} maxBarSize={20} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Temporal namespace health cards */}
        <div className="card flex flex-col gap-3">
          <div className="text-xs text-fg-muted font-medium">Temporal Namespace Health</div>
          {isLoading && <LoadingSkeleton rows={4} />}
          {isError && <EmptyState message="Failed to load workflow data" />}
          {!isLoading && stats.length === 0 && (
            <EmptyState message="No workflow data" sub="Temporal metrics not found" />
          )}
          <div className="flex flex-col gap-3 overflow-y-auto max-h-72">
            {stats.map((s) => {
              const rate = s.completed + s.failed > 0
                ? s.completed / (s.completed + s.failed) : 0
              const health = rate >= 0.95 ? 'success' :
                             rate >= 0.85 ? 'warning' : 'danger'
              return (
                <div key={s.namespace} className="border border-border rounded-md p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-xs font-medium text-fg">{s.namespace}</div>
                    <span className={`pill pill-${health}`}>
                      {(rate * 100).toFixed(0)}% ok
                    </span>
                  </div>
                  <StatRow label="Active"    value={s.active} />
                  <StatRow label="Completed" value={s.completed} />
                  <StatRow label="Failed"    value={s.failed}    color={s.failed > 0 ? '#f85149' : undefined} />
                  <StatRow label="Timed Out" value={s.timed_out} color={s.timed_out > 0 ? '#d29922' : undefined} />
                  <StatRow label="Canceled"  value={totCanceled} color={totCanceled > 0 ? '#d29922' : undefined} />
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Activity errors */}
      <div className="card">
        <div className="text-xs text-fg-muted font-medium mb-3">Activity Error Rate</div>
        <div className="flex items-center gap-4">
          <div className="text-3xl font-semibold tabular-nums" style={{ color: errCount > 0 ? '#f85149' : '#3fb950' }}>
            {errCount.toFixed(0)}
          </div>
          <div className="text-xs text-fg-subtle">
            total activity errors across all workflows
          </div>
        </div>
      </div>
    </div>
  )
}
