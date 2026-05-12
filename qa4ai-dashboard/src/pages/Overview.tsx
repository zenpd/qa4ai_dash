import { Link } from 'react-router-dom'
import { useFilters } from '../store/filters'
import {
  useOverallQeScore,
  useCiGatePassRate,
  useTraceCounts,
  useWorkflowActive,
  useWorkflowCompleted,
  useWorkflowFailed,
  useMaturityScore,
  useTraceMetrics,
  scalar,
  pct,
} from '../api/prometheus'
import KpiCard from '../components/common/KpiCard'
import LoadingSkeleton from '../components/common/LoadingSkeleton'
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, ResponsiveContainer, Tooltip,
} from 'recharts'

const PILLARS = [
  { key: 'correctness',   label: 'Correctness',   path: '/correctness',   icon: '✓' },
  { key: 'reliability',   label: 'Reliability',   path: '/reliability',   icon: '◎' },
  { key: 'observability', label: 'Observability', path: '/observability', icon: '◈' },
  { key: 'governance',    label: 'Governance',    path: '/governance',    icon: '⬗' },
]

export default function Overview() {
  const { project } = useFilters()

  const qeScore    = useOverallQeScore(project)
  const gateRate   = useCiGatePassRate(project)
  const traces     = useTraceCounts(project)
  const actives    = useWorkflowActive()
  const completed  = useWorkflowCompleted()
  const failed     = useWorkflowFailed()
  const maturity   = useMaturityScore(project)
  const { traces: traceMetrics, isLoading: trLoading } = useTraceMetrics(project)

  // ── Per-evaluator thresholds (must match prometheus.ts EVAL_THRESHOLDS) ────
  const EVAL_THRESHOLDS: Record<string, number> = {
    response_quality:     0.75,
    latency_quality:      0.65,
    token_efficiency:     0.70,
    pep_accuracy:         0.95,
    fatca_accuracy:       0.95,
    aml_decision_quality: 0.90,
    escalation_quality:   0.88,
    factual_grounding:    0.85,
    kyc_quality:          0.85,
  }
  const DEFAULT_THRESHOLD = 0.80

  const qeVal     = scalar(qeScore.data ?? [])
  const tracesCnt = (traces.data ?? []).reduce((s, r) => s + parseFloat(r.value[1]), 0)
  const wfActive  = (actives.data ?? []).reduce((s, r) => s + parseFloat(r.value[1]), 0)
  const wfDone    = (completed.data ?? []).reduce((s, r) => s + parseFloat(r.value[1]), 0)
  const wfFailed  = (failed.data ?? []).reduce((s, r) => s + parseFloat(r.value[1]), 0)
  const matVal    = scalar(maturity.data ?? [])

  const hasEvalScores = (qeScore.data?.length ?? 0) > 0

  // ── CI Gate Pass Rate: fraction of per-(project,evaluator) scores meeting threshold ──
  const gateRows = gateRate.data ?? []
  const gateVal = gateRows.length > 0
    ? gateRows.filter((r) => {
        const evalName = r.metric.evaluator_name ?? ''
        const thresh = EVAL_THRESHOLDS[evalName] ?? DEFAULT_THRESHOLD
        return parseFloat(r.value[1]) >= thresh
      }).length / gateRows.length
    : 0

  // ── Trace-derived fallback scores ──────────────────────────────────────────
  // Correctness proxy: avg latency quality across active projects
  const activeTraces = traceMetrics.filter((t) => t.count > 0 && t.latency_p99 > 0)
  const derivedCorrectness = activeTraces.length
    ? activeTraces.reduce((s, t) => s + Math.max(0, Math.min(1, 1 - (t.latency_p99 - 2000) / 8000)), 0) / activeTraces.length
    : 0

  // Reliability proxy: workflow success rate (completed / (completed + failed))
  const derivedReliability = (wfDone + wfFailed) > 0
    ? wfDone / (wfDone + wfFailed)
    : wfDone > 0 ? 1 : 0.5

  // Governance proxy: avg domain score from traces (p50 + p99 + token coverage)
  const derivedGovernance = activeTraces.length
    ? activeTraces.reduce((s, t) => s + Math.max(0, Math.min(1, 1 - (t.latency_p50 - 1000) / 9000)), 0) / activeTraces.length
    : 0

  // Final pillar values — real evaluator scores take priority
  const correctnessVal   = hasEvalScores ? qeVal   : derivedCorrectness
  const reliabilityVal   = hasEvalScores ? gateVal : derivedReliability
  // AI Maturity uses span success rate (distinct from QE score)
  const matValPct        = matVal > 0 ? matVal : (hasEvalScores ? qeVal : derivedGovernance)
  const governanceVal    = matValPct
  const observabilityVal = tracesCnt > 0
    ? Math.min(1, 0.6 + Math.log10(tracesCnt) / 10)
    : 0.1

  const loading = qeScore.isLoading || gateRate.isLoading || trLoading

  const radarData = [
    { subject: 'Correctness',   value: correctnessVal   * 100 },
    { subject: 'Reliability',   value: reliabilityVal   * 100 },
    { subject: 'Observability', value: observabilityVal * 100 },
    { subject: 'Governance',    value: governanceVal    * 100 },
  ]

  return (
    <div className="p-5 flex flex-col gap-5">

      {/* Top KPI strip */}
      {loading ? (
        <LoadingSkeleton rows={1} height="h-20" />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <KpiCard
            label="Overall QE Score"
            value={pct(correctnessVal)}
            color={correctnessVal >= 0.85 ? 'success' : correctnessVal >= 0.5 ? 'warning' : 'danger'}
            sub={hasEvalScores ? `avg of ${(qeScore.data ?? []).length} evaluators` : 'latency-quality proxy'}
            passing={hasEvalScores ? correctnessVal >= 0.85 : undefined}
          />
          <KpiCard
            label="CI Gate Pass Rate"
            value={pct(reliabilityVal)}
            color={reliabilityVal >= 0.9 ? 'success' : reliabilityVal >= 0.6 ? 'warning' : 'danger'}
            sub={hasEvalScores
              ? `${gateRows.filter((r) => parseFloat(r.value[1]) >= (EVAL_THRESHOLDS[r.metric.evaluator_name ?? ''] ?? DEFAULT_THRESHOLD)).length}/${gateRows.length} evaluators ≥ threshold`
              : 'workflow success rate'}
            passing={hasEvalScores ? reliabilityVal >= 0.90 : undefined}
          />
          <KpiCard
            label="Total Traces"
            value={tracesCnt.toFixed(0)}
            color="accent"
            sub="across all projects"
            passing={tracesCnt >= 100}
          />
          <KpiCard
            label="Active Workflows"
            value={wfActive.toFixed(0)}
            color="default"
            sub="Temporal workflows"
            passing={wfActive >= 1}
          />
          <KpiCard
            label="AI Maturity Score"
            value={pct(governanceVal)}
            color={governanceVal >= 0.6 ? 'success' : governanceVal >= 0.4 ? 'warning' : 'danger'}
            sub={matVal > 0 ? 'span success rate (ops health)' : hasEvalScores ? 'evaluator-derived proxy' : 'latency-derived proxy'}
            passing={governanceVal > 0 ? governanceVal >= 0.60 : undefined}
          />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Radar chart */}
        <div className="card lg:col-span-1 flex flex-col gap-3">
          <div className="text-xs text-fg-muted font-medium">
            Pillar Scores
            {!hasEvalScores && !loading && (
              <span className="ml-2 text-warning font-normal">(trace-derived)</span>
            )}
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <RadarChart data={radarData}>
              <PolarGrid stroke="#d0d7de" />
              <PolarAngleAxis
                dataKey="subject"
                tick={{ fill: '#57606a', fontSize: 11 }}
              />
              <Radar
                dataKey="value"
                stroke="#0969da"
                fill="#0969da"
                fillOpacity={0.2}
                strokeWidth={2}
              />
              <Tooltip
                contentStyle={{ background: '#ffffff', border: '1px solid #d0d7de', borderRadius: 6 }}
                labelStyle={{ color: '#24292f' }}
                formatter={(v: number) => [`${v.toFixed(1)}%`, 'Score']}
              />
            </RadarChart>
          </ResponsiveContainer>
        </div>

        {/* Pillar cards */}
        <div className="lg:col-span-2 grid grid-cols-2 gap-3">
          {PILLARS.map(({ key, label, path, icon }) => (
            <Link key={key} to={path} className="card hover:border-accent/40 transition-colors group">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-lg text-accent">{icon}</span>
                <span className="text-sm font-medium text-fg group-hover:text-accent transition-colors">
                  {label}
                </span>
              </div>
              <div className="text-xs text-fg-subtle">
                Click to explore {label.toLowerCase()} metrics →
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* ── AI Fluency 4Ds ── */}
      <div className="card flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <div className="text-xs font-semibold text-fg uppercase tracking-wider">AI Fluency Framework — The 4Ds</div>
          <div className="text-xs text-fg-muted">
            This dashboard's four pillars map directly to the <span className="text-accent font-medium">AI Fluency 4Ds</span> — a competency model for responsible, effective AI use.
            Each D describes a dimension of human capability required to work well alongside AI systems.
          </div>
        </div>

        {/* 4Ds description row */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            {
              d: 'D1',
              name: 'Delegation',
              color: '#d29922',
              desc: 'Knowing what to hand off to AI and what to keep human. Delegation requires understanding AI\'s strengths and limits, setting boundaries, and designing workflows that are appropriately automated.',
            },
            {
              d: 'D2',
              name: 'Description',
              color: '#bc8cff',
              desc: 'Communicating intent clearly to AI through precise prompts, goals, and context. Description is the craft of framing tasks so AI understands exactly what is needed and produces useful, targeted outputs.',
            },
            {
              d: 'D3',
              name: 'Discernment',
              color: '#58a6ff',
              desc: 'The ability to critically evaluate AI outputs — judging relevance, accuracy, and appropriateness. Discernment means knowing when to trust, question, or override what AI produces.',
            },
            {
              d: 'D4',
              name: 'Diligence',
              color: '#3fb950',
              desc: 'Responsible, consistent, and accountable AI use over time. Diligence requires transparency about AI\'s role, ownership of outputs, and ethical, compliant behaviour across every interaction.',
            },
          ].map(({ d, name, color, desc }) => (
            <div key={d} className="rounded-lg border border-border bg-canvas-subtle p-3 flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono font-bold px-1.5 py-0.5 rounded" style={{ background: `${color}22`, color }}>{d}</span>
                <span className="text-sm font-semibold text-fg">{name}</span>
              </div>
              <p className="text-xs text-fg-muted leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>

        {/* Pillar → 4D mapping */}
        <div>
          <div className="text-xs font-medium text-fg-muted mb-2 uppercase tracking-wide">How the Pillars Map to the 4Ds</div>
          <div className="flex flex-col gap-2">
            {[
              {
                pillar: '01 · Correctness & Evaluation',
                icon: '✓',
                ds: ['Discernment'],
                dsColors: ['#58a6ff'],
                path: '/correctness',
                detail: 'Evaluating AI outputs for accuracy, relevance, and usability is the core act of Discernment — knowing whether to accept, reject, or refine what the model produced.',
              },
              {
                pillar: '02 · Reliability & Durability',
                icon: '◎',
                ds: ['Diligence'],
                dsColors: ['#3fb950'],
                path: '/reliability',
                detail: 'Consistent, stable performance over repeated interactions — with transparency about AI\'s role and accountability for outputs — is the definition of Diligence.',
              },
              {
                pillar: '03 · Observability & Tracing',
                icon: '◈',
                ds: ['Discernment', 'Diligence'],
                dsColors: ['#58a6ff', '#3fb950'],
                path: '/observability',
                detail: 'Tracing and logging AI reasoning supports Discernment (inspecting outputs) and Diligence (audit trails, accountability). You cannot be responsible for outputs you cannot observe.',
              },
              {
                pillar: '04 · Governance & Compliance',
                icon: '⬗',
                ds: ['Diligence', 'Delegation'],
                dsColors: ['#3fb950', '#d29922'],
                path: '/governance',
                detail: 'Policies, privacy, and regulatory adherence are the pillars of Diligence. They also shape Delegation — deciding which tasks to automate requires understanding compliance boundaries and organisational risk.',
              },
            ].map(({ pillar, icon, ds, dsColors, path, detail }) => (
              <Link
                key={path}
                to={path}
                className="flex items-start gap-3 rounded-md border border-border/50 bg-canvas px-3 py-2.5 hover:border-accent/30 hover:bg-canvas-subtle transition-colors group"
              >
                <span className="text-base text-accent mt-0.5 shrink-0">{icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="text-xs font-semibold text-fg group-hover:text-accent transition-colors">{pillar}</span>
                    <span className="text-fg-subtle text-xs">→</span>
                    {ds.map((d, i) => (
                      <span
                        key={d}
                        className="text-xs font-medium px-1.5 py-0.5 rounded"
                        style={{ background: `${dsColors[i]}22`, color: dsColors[i] }}
                      >
                        {d}
                      </span>
                    ))}
                  </div>
                  <p className="text-xs text-fg-muted leading-relaxed">{detail}</p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
