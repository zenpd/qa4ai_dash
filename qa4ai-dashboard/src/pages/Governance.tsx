import { useFilters } from '../store/filters'
import { useComplianceScores, useMaturityScore, useTraceMetrics, scalar, scoreColor, pct } from '../api/prometheus'
import KpiCard from '../components/common/KpiCard'
import LoadingSkeleton from '../components/common/LoadingSkeleton'
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis,
  ResponsiveContainer, Tooltip, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Cell,
} from 'recharts'

const EVAL_TO_DOMAIN: Record<string, string> = {
  response_quality: 'Decision Quality',
  latency_quality:  'Process Timeliness',
  token_efficiency: 'Token Efficiency',
}

const MATURITY_LEVELS = [
  { min: 0,    max: 0.2,  label: 'Level 1 — Initial',      color: '#f85149' },
  { min: 0.2,  max: 0.4,  label: 'Level 2 — Managed',      color: '#db6d28' },
  { min: 0.4,  max: 0.6,  label: 'Level 3 — Defined',      color: '#d29922' },
  { min: 0.6,  max: 0.8,  label: 'Level 4 — Quantified',   color: '#3fb950' },
  { min: 0.8,  max: 1.01, label: 'Level 5 — Optimizing',   color: '#39d353' },
]

const TOOLTIP_STYLE = {
  contentStyle: { background: '#ffffff', border: '1px solid #d0d7de', borderRadius: 6 },
  labelStyle:  { color: '#24292f' },
}

const EVAL_THRESHOLDS: Record<string, number> = {
  response_quality: 0.75,
  latency_quality:  0.65,
  token_efficiency: 0.70,
}

// Derive governance domains from trace metrics when evaluator scores are unavailable
function deriveDomainsFromTraces(traces: ReturnType<typeof useTraceMetrics>['traces']) {
  const activeProjects = traces.filter((t) => t.count > 0)
  if (activeProjects.length === 0) return []

  // Decision Quality: derived from p50 latency (< 3000ms = excellent)
  const decisionScores = activeProjects
    .filter((t) => t.latency_p50 > 0)
    .map((t) => Math.max(0, Math.min(1, 1 - (t.latency_p50 - 1000) / 9000)))
  const decisionAvg = decisionScores.length
    ? decisionScores.reduce((s, v) => s + v, 0) / decisionScores.length
    : 0.5

  // Process Timeliness: derived from p99 latency (< 5000ms = good)
  const timelinessScores = activeProjects
    .filter((t) => t.latency_p99 > 0)
    .map((t) => Math.max(0, Math.min(1, 1 - (t.latency_p99 - 2000) / 8000)))
  const timelinessAvg = timelinessScores.length
    ? timelinessScores.reduce((s, v) => s + v, 0) / timelinessScores.length
    : 0.5

  // Token Efficiency: ratio of projects with token data (coverage proxy)
  const withTokens = activeProjects.filter((t) => t.tokens_input > 0).length
  const tokenAvg = activeProjects.length > 0 ? withTokens / activeProjects.length : 0

  return [
    { name: 'Decision Quality',    evalName: 'latency_quality (p50)',  score: decisionAvg * 100,    threshold: EVAL_THRESHOLDS.latency_quality  * 100, passing: decisionAvg    >= EVAL_THRESHOLDS.latency_quality,  synthetic: true },
    { name: 'Process Timeliness',  evalName: 'latency_quality (p99)',  score: timelinessAvg * 100,  threshold: EVAL_THRESHOLDS.latency_quality  * 100, passing: timelinessAvg  >= EVAL_THRESHOLDS.latency_quality,  synthetic: true },
    { name: 'Token Efficiency',    evalName: 'token_coverage',         score: tokenAvg * 100,       threshold: EVAL_THRESHOLDS.token_efficiency * 100, passing: tokenAvg       >= EVAL_THRESHOLDS.token_efficiency, synthetic: true },
  ].sort((a, b) => b.score - a.score)
}

export default function Governance() {
  const { project } = useFilters()
  const compliance = useComplianceScores(project)
  const maturity   = useMaturityScore(project)
  const { traces, isLoading: trLoading } = useTraceMetrics(project)

  const hasRealScores = (compliance.data?.length ?? 0) > 0

  // ── Real evaluator data path ──────────────────────────────────────────────
  const evalTotals = new Map<string, { sum: number; count: number }>()
  compliance.data?.forEach((r) => {
    const evalName = r.metric.evaluator_name ?? 'unknown'
    const s = parseFloat(r.value[1])
    const cur = evalTotals.get(evalName) ?? { sum: 0, count: 0 }
    cur.sum += s; cur.count++
    evalTotals.set(evalName, cur)
  })

  const realDomains = [...evalTotals.entries()].map(([evalName, { sum, count }]) => {
    const avg   = sum / count
    const th    = EVAL_THRESHOLDS[evalName] ?? 0.80
    const label = EVAL_TO_DOMAIN[evalName] ?? evalName.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
    return { name: label, evalName, score: avg * 100, threshold: th * 100, passing: avg >= th, synthetic: false }
  }).sort((a, b) => b.score - a.score)

  const matValRaw  = scalar(maturity.data ?? [])

  // ── Trace-derived fallback path ───────────────────────────────────────────
  const derivedDomains = deriveDomainsFromTraces(traces)
  const activeProjects = traces.filter((t) => t.count > 0)

  // Maturity proxy from trace coverage when evaluator scores absent
  const derivedMatScore = derivedDomains.length
    ? derivedDomains.reduce((s, d) => s + d.score / 100, 0) / derivedDomains.length
    : 0

  // ── Unified values ────────────────────────────────────────────────────────
  const domains   = hasRealScores ? realDomains : derivedDomains
  const matVal    = hasRealScores ? matValRaw   : derivedMatScore
  const matLevel  = MATURITY_LEVELS.find((l) => matVal >= l.min && matVal < l.max) ?? MATURITY_LEVELS[0]

  const overallCompliance = domains.length
    ? domains.reduce((s, d) => s + d.score, 0) / domains.length
    : 0
  const domainsPass = domains.filter((d) => d.passing).length
  const evaluatorsActive = hasRealScores ? evalTotals.size : activeProjects.length

  const radarData = domains.map((d) => ({
    subject: d.name.length > 18 ? d.name.slice(0, 16) + '…' : d.name,
    score:   d.score,
  }))

  const isLoading = compliance.isLoading || maturity.isLoading || trLoading

  return (
    <div className="p-5 flex flex-col gap-5">

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard
          label="AI Maturity Score"
          value={`${(matVal * 100).toFixed(0)}%`}
          sub={matLevel.label}
          color={matVal >= 0.6 ? 'success' : matVal >= 0.4 ? 'warning' : 'danger'}
        />
        <KpiCard
          label="Avg Compliance Score"
          value={`${overallCompliance.toFixed(0)}%`}
          color={overallCompliance >= 75 ? 'success' : overallCompliance >= 55 ? 'warning' : 'danger'}
        />
        <KpiCard
          label="Domains Passing"
          value={`${domainsPass} / ${domains.length}`}
          color={domainsPass === domains.length && domains.length > 0 ? 'success' : domainsPass > 0 ? 'warning' : 'danger'}
        />
        <KpiCard
          label={hasRealScores ? 'Evaluators Active' : 'Active Projects'}
          value={evaluatorsActive}
          sub={hasRealScores ? 'domains tracked' : 'with live traces'}
          color="accent"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Maturity model */}
        <div className="card flex flex-col gap-4">
          <div className="text-xs text-fg-muted font-medium">AI Maturity Model</div>
          {isLoading ? (
            <div className="flex flex-col gap-2">
              {MATURITY_LEVELS.map((l) => (
                <div key={l.label} className="h-10 rounded-md bg-canvas-subtle animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {MATURITY_LEVELS.map((level) => {
                const active = matVal >= level.min && matVal < level.max
                return (
                  <div
                    key={level.label}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-md border transition-all
                      ${active ? 'border-current bg-canvas-subtle' : 'border-border opacity-40'}`}
                    style={active ? { borderColor: level.color, color: level.color } : {}}
                  >
                    <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: level.color }} />
                    <span className="text-xs" style={active ? { color: level.color } : { color: '#8b949e' }}>
                      {level.label}
                    </span>
                    {active && (
                      <span className="ml-auto text-xs font-medium" style={{ color: level.color }}>
                        ← Current ({(matVal * 100).toFixed(0)}%)
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Compliance radar */}
        <div className="card flex flex-col gap-3">
          <div className="text-xs text-fg-muted font-medium">Governance Domain Coverage</div>
          {isLoading ? (
            <LoadingSkeleton rows={5} />
          ) : radarData.length === 0 ? (
            <div className="flex-1 flex items-center justify-center py-10 text-xs text-fg-muted">
              No trace data available yet
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <RadarChart data={radarData}>
                <PolarGrid stroke="#d0d7de" />
                <PolarAngleAxis dataKey="subject" tick={{ fill: '#57606a', fontSize: 10 }} />
                <Radar dataKey="score" stroke="#3fb950" fill="#3fb950" fillOpacity={0.15} strokeWidth={2} />
                <Tooltip {...TOOLTIP_STYLE} formatter={(v: number) => [`${(v as number).toFixed(1)}%`, 'Score']} />
              </RadarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Domain bar chart + table */}
      <div className="card flex flex-col gap-3">
        <div className="text-xs text-fg-muted font-medium">
          Governance Score by Domain
          {!hasRealScores && domains.length > 0 && (
            <span className="ml-2 text-warning font-normal">(trace-derived proxy)</span>
          )}
        </div>
        {isLoading ? (
          <LoadingSkeleton rows={4} height="h-6" />
        ) : domains.length === 0 ? (
          <div className="py-10 text-center text-xs text-fg-muted">
            No domain data — waiting for trace or evaluator data
          </div>
        ) : (
          <>
            <ResponsiveContainer width="100%" height={Math.max(120, domains.length * 40)}>
              <BarChart data={domains} layout="vertical" margin={{ left: 8, right: 60 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e1e4e8" horizontal={false} />
                <XAxis type="number" domain={[0, 100]} tickFormatter={(v) => `${v}%`} tick={{ fill: '#57606a', fontSize: 10 }} />
                <YAxis
                  type="category" dataKey="name" width={150}
                  tick={{ fill: '#57606a', fontSize: 10 }}
                  tickFormatter={(v: string) => v.length > 22 ? v.slice(0, 20) + '…' : v}
                />
                <Tooltip
                  {...TOOLTIP_STYLE}
                  formatter={(v: number, _: unknown, props: { payload?: { threshold?: number } }) =>
                    [`${(v as number).toFixed(1)}% (threshold: ${props.payload?.threshold?.toFixed(0) ?? '—'}%)`, 'Score']
                  }
                />
                <Bar dataKey="score" radius={[0, 4, 4, 0]} maxBarSize={22}>
                  {domains.map((d) => (
                    <Cell key={d.name} fill={scoreColor(d.score / 100, d.threshold / 100)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <table className="w-full text-xs border-collapse mt-2">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-1.5 px-2 text-fg-muted font-medium">Domain</th>
                  <th className="text-left py-1.5 px-2 text-fg-muted font-medium">
                    {hasRealScores ? 'Evaluator' : 'Metric Source'}
                  </th>
                  <th className="text-right py-1.5 px-2 text-fg-muted font-medium">Score</th>
                  <th className="text-right py-1.5 px-2 text-fg-muted font-medium">Threshold</th>
                  <th className="text-center py-1.5 px-2 text-fg-muted font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {domains.map((d) => (
                  <tr key={d.name} className="border-b border-border last:border-0 hover:bg-canvas-subtle">
                    <td className="py-2 px-2 font-medium">{d.name}</td>
                    <td className="py-2 px-2 font-mono text-fg-muted">{d.evalName}</td>
                    <td className="py-2 px-2 text-right font-bold" style={{ color: scoreColor(d.score / 100, d.threshold / 100) }}>
                      {pct(d.score / 100)}
                    </td>
                    <td className="py-2 px-2 text-right text-fg-muted">{pct(d.threshold / 100)}</td>
                    <td className="py-2 px-2 text-center">
                      {d.passing
                        ? <span className="text-success font-semibold">✓ Pass</span>
                        : <span className="text-danger font-semibold">✗ Fail</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  )
}
