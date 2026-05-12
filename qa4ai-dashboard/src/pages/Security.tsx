import { useFilters } from '../store/filters'
import { useSecurityEvaluators, scoreColor, pct } from '../api/prometheus'
import KpiCard from '../components/common/KpiCard'
import LoadingSkeleton from '../components/common/LoadingSkeleton'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, Cell,
} from 'recharts'

// ─── Static metadata ──────────────────────────────────────────────────────────

const TEAM_META = {
  red: {
    color:   '#f85149',
    bg:      '#f8514920',
    badge:   'bg-red-500/20 text-red-400',
    icon:    '🔴',
    label:   'Red Team',
    desc:    'Attack resistance — did adversarial inputs fool the agent?',
    thresholdLabel: 'Resistance threshold',
  },
  blue: {
    color:   '#58a6ff',
    bg:      '#58a6ff20',
    badge:   'bg-blue-500/20 text-blue-400',
    icon:    '🔵',
    label:   'Blue Team',
    desc:    'Defence effectiveness — did guardrails and controls activate?',
    thresholdLabel: 'Defence threshold',
  },
  purple: {
    color:   '#bc8cff',
    bg:      '#bc8cff20',
    badge:   'bg-purple-500/20 text-purple-400',
    icon:    '🟣',
    label:   'Purple Team',
    desc:    'Combined outcome — overall security resilience score',
    thresholdLabel: 'Resilience threshold',
  },
} as const

type Team = keyof typeof TEAM_META

const EVAL_LABELS: Record<string, string> = {
  'eval.red.prompt_injection_resistance':       'Prompt Injection Resistance',
  'eval.red.adversarial_kyc_bypass_detection':  'Adversarial KYC Bypass Detection',
  'eval.red.social_engineering_resistance':     'Social Engineering Resistance',
  'eval.red.pii_exfiltration_resistance':       'PII Exfiltration Resistance',
  'eval.blue.guardrail_trigger_effectiveness':  'Guardrail Trigger Effectiveness',
  'eval.blue.pii_redaction_effectiveness':      'PII Redaction Effectiveness',
  'eval.blue.escalation_on_attack':             'Escalation on Attack',
  'eval.purple.resilience_score':               'Purple Team Resilience Score',
}

const TEAM_ORDER: Record<Team, string[]> = {
  red:    [
    'eval.red.prompt_injection_resistance',
    'eval.red.adversarial_kyc_bypass_detection',
    'eval.red.social_engineering_resistance',
    'eval.red.pii_exfiltration_resistance',
  ],
  blue:   [
    'eval.blue.guardrail_trigger_effectiveness',
    'eval.blue.pii_redaction_effectiveness',
    'eval.blue.escalation_on_attack',
  ],
  purple: [
    'eval.purple.resilience_score',
  ],
}

const THRESHOLD = 0.80   // 80% — pass threshold for all security evals

const TOOLTIP_STYLE = {
  contentStyle: { background: '#ffffff', border: '1px solid #d0d7de', borderRadius: 6 },
  labelStyle:  { color: '#24292f' },
}

// ─── Sub-components ────────────────────────────────────────────────────────────

interface EvalRow { name: string; fullName: string; score: number }

function TeamSection({
  team,
  rows,
}: {
  team: Team
  rows: EvalRow[]
}) {
  const meta = TEAM_META[team]

  const chartData = rows.map((r) => ({
    subject: r.name.length > 30 ? r.name.slice(0, 28) + '…' : r.name,
    score:   parseFloat((r.score * 100).toFixed(1)),
    raw:     r.score,
  }))

  return (
    <div className="card p-5">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-lg">{meta.icon}</span>
        <div>
          <h3 className="text-sm font-semibold text-fg-default">{meta.label} Evaluators</h3>
          <p className="text-xs text-fg-subtle mt-0.5">{meta.desc}</p>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="flex items-center justify-center h-24 text-fg-subtle text-xs border border-dashed border-border rounded">
          No {meta.label.toLowerCase()} data yet — run security evaluations to populate
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={Math.max(120, rows.length * 52)}>
          <BarChart
            data={chartData}
            layout="vertical"
            margin={{ top: 4, right: 60, left: 8, bottom: 4 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#d0d7de" horizontal={false} />
            <XAxis
              type="number"
              domain={[0, 100]}
              tickFormatter={(v) => `${v}%`}
              tick={{ fill: '#57606a', fontSize: 11 }}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              type="category"
              dataKey="subject"
              width={200}
              tick={{ fill: '#24292f', fontSize: 11 }}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              {...TOOLTIP_STYLE}
              formatter={(v: number) => [`${v.toFixed(1)}%`, 'Score']}
            />
            <ReferenceLine
              x={THRESHOLD * 100}
              stroke="#57606a"
              strokeDasharray="4 2"
              label={{ value: `${THRESHOLD * 100}%`, fill: '#57606a', fontSize: 10, position: 'insideTopRight' }}
            />
            <Bar dataKey="score" radius={[0, 3, 3, 0]} maxBarSize={22}>
              {chartData.map((d, i) => (
                <Cell key={i} fill={scoreColor(d.raw, THRESHOLD)} fillOpacity={0.9} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function Security() {
  const { project } = useFilters()
  const { data, isLoading, isError } = useSecurityEvaluators(project)

  // Group results by team, keyed by evaluator_name label
  const byEval = new Map<string, number>()
  data?.forEach((r) => {
    const name = r.metric.evaluator_name ?? ''
    byEval.set(name, parseFloat(r.value[1]))
  })

  function teamRows(team: Team): EvalRow[] {
    return TEAM_ORDER[team]
      .filter((key) => byEval.has(key))
      .map((key) => ({
        name:     EVAL_LABELS[key] ?? key,
        fullName: key,
        score:    byEval.get(key) ?? 0,
      }))
  }

  const redRows    = teamRows('red')
  const blueRows   = teamRows('blue')
  const purpleRows = teamRows('purple')

  const teamAvg = (rows: EvalRow[]) =>
    rows.length ? rows.reduce((s, r) => s + r.score, 0) / rows.length : null

  const redAvg    = teamAvg(redRows)
  const blueAvg   = teamAvg(blueRows)
  const purpleAvg = teamAvg(purpleRows)

  const hasData = byEval.size > 0

  const overallScore = hasData
    ? [redAvg, blueAvg, purpleAvg].filter((v) => v !== null).reduce((s, v) => s + v!, 0) /
      [redAvg, blueAvg, purpleAvg].filter((v) => v !== null).length
    : null

  // Evaluators passing threshold
  const totalEvals  = redRows.length + blueRows.length + purpleRows.length
  const passingEvals = [...redRows, ...blueRows, ...purpleRows].filter((r) => r.score >= THRESHOLD).length

  if (isLoading) {
    return (
      <div className="p-6">
        <LoadingSkeleton rows={8} height="h-10" />
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6">

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-lg font-semibold text-fg-default">Security Testing</h1>
          <p className="text-sm text-fg-subtle mt-0.5">
            Red / Blue / Purple team evaluation — digital-onboarding agent
          </p>
        </div>
        <div className="flex gap-2">
          {(['red', 'blue', 'purple'] as Team[]).map((t) => (
            <span key={t} className={`text-xs font-medium px-2 py-0.5 rounded ${TEAM_META[t].badge}`}>
              {TEAM_META[t].icon} {TEAM_META[t].label}
            </span>
          ))}
        </div>
      </div>

      {/* Error banner */}
      {isError && (
        <div className="px-4 py-3 rounded border border-yellow-500/30 bg-yellow-500/10 text-yellow-400 text-sm">
          Could not reach Prometheus. Showing last cached values or empty state.
        </div>
      )}

      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard
          label="Overall Security Score"
          value={overallScore !== null ? pct(overallScore) : '—'}
          sub={hasData ? `${passingEvals}/${totalEvals} evaluators passing` : 'No evaluations run yet'}
          color={overallScore === null ? 'default' : overallScore >= THRESHOLD ? 'success' : overallScore >= THRESHOLD * 0.85 ? 'warning' : 'danger'}
        />
        <KpiCard
          label="🔴 Red Team"
          value={redAvg !== null ? pct(redAvg) : '—'}
          sub={redAvg !== null ? (redAvg >= THRESHOLD ? 'Attack resistant' : 'Below threshold') : 'No data'}
          color={redAvg === null ? 'default' : redAvg >= THRESHOLD ? 'success' : redAvg >= THRESHOLD * 0.85 ? 'warning' : 'danger'}
        />
        <KpiCard
          label="🔵 Blue Team"
          value={blueAvg !== null ? pct(blueAvg) : '—'}
          sub={blueAvg !== null ? (blueAvg >= THRESHOLD ? 'Defences active' : 'Below threshold') : 'No data'}
          color={blueAvg === null ? 'default' : blueAvg >= THRESHOLD ? 'success' : blueAvg >= THRESHOLD * 0.85 ? 'warning' : 'danger'}
        />
        <KpiCard
          label="🟣 Purple Team"
          value={purpleAvg !== null ? pct(purpleAvg) : '—'}
          sub={purpleAvg !== null ? (purpleAvg >= THRESHOLD ? 'Resilient' : 'Below threshold') : 'No data'}
          color={purpleAvg === null ? 'default' : purpleAvg >= THRESHOLD ? 'success' : purpleAvg >= THRESHOLD * 0.85 ? 'warning' : 'danger'}
        />
      </div>

      {/* No-data guidance */}
      {!hasData && (
        <div className="card p-6 border border-dashed border-border">
          <h3 className="text-sm font-semibold text-fg-default mb-2">No security evaluations found</h3>
          <p className="text-xs text-fg-subtle mb-4">
            Run the security evaluation pipeline from the digital-onboarding backend to populate these charts.
            Evaluations post results to Phoenix which are then scraped by Prometheus.
          </p>
          <div className="space-y-1">
            <p className="text-xs text-fg-subtle font-mono bg-canvas-overlay rounded px-3 py-2">
              # Step 1 — Register Phoenix annotation configs (once)
            </p>
            <p className="text-xs font-mono bg-canvas-overlay rounded px-3 py-2 text-fg-default">
              PYTHONPATH=. python -m evaluations.setup_phoenix
            </p>
            <p className="text-xs text-fg-subtle font-mono bg-canvas-overlay rounded px-3 py-2 mt-3">
              # Step 2 — Replay TIER 3 adversarial scenarios
            </p>
            <p className="text-xs font-mono bg-canvas-overlay rounded px-3 py-2 text-fg-default">
              PYTHONPATH=. python -m evaluations.replay_scenarios --tier 3
            </p>
            <p className="text-xs text-fg-subtle font-mono bg-canvas-overlay rounded px-3 py-2 mt-3">
              # Step 3 — Run security evaluations and post to Phoenix
            </p>
            <p className="text-xs font-mono bg-canvas-overlay rounded px-3 py-2 text-fg-default">
              PYTHONPATH=. python -m evaluations.run_security_evals
            </p>
          </div>
        </div>
      )}

      {/* Team bar charts — 2 col grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <TeamSection team="red"  rows={redRows} />
        <TeamSection team="blue" rows={blueRows} />
      </div>

      {/* Purple team — full width */}
      <TeamSection team="purple" rows={purpleRows} />

      {/* Evaluator legend table */}
      {hasData && (
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-fg-default mb-3">Evaluator Detail</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-fg-subtle">
                  <th className="text-left pb-2 pr-4">Team</th>
                  <th className="text-left pb-2 pr-4">Evaluator</th>
                  <th className="text-left pb-2 pr-4">Type</th>
                  <th className="text-right pb-2">Score</th>
                  <th className="text-right pb-2 pl-4">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {(['red', 'blue', 'purple'] as Team[]).flatMap((team) =>
                  teamRows(team).map((row) => {
                    const isCode = row.fullName.includes('guardrail') || row.fullName.includes('redaction')
                    const passing = row.score >= THRESHOLD
                    return (
                      <tr key={row.fullName} className="hover:bg-canvas-overlay/50">
                        <td className="py-1.5 pr-4">
                          <span className={`text-xs px-1.5 py-0.5 rounded ${TEAM_META[team].badge}`}>
                            {TEAM_META[team].icon}
                          </span>
                        </td>
                        <td className="py-1.5 pr-4 text-fg-default">{row.name}</td>
                        <td className="py-1.5 pr-4 text-fg-subtle">{isCode ? 'CODE' : 'LLM'}</td>
                        <td className="py-1.5 text-right font-mono" style={{ color: scoreColor(row.score, THRESHOLD) }}>
                          {pct(row.score)}
                        </td>
                        <td className="py-1.5 pl-4 text-right">
                          <span className={`px-1.5 py-0.5 rounded text-xs ${passing ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                            {passing ? 'PASS' : 'FAIL'}
                          </span>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Footer note */}
      <div className="text-xs text-fg-subtle border-t border-border pt-3">
        Scores sourced from Phoenix annotation labels posted by{' '}
        <code className="text-fg-default">evaluations/run_security_evals.py</code>
        {' '}→ scraped by Prometheus. Threshold: {THRESHOLD * 100}%.
        LLM evaluators require Azure OpenAI private endpoint access.
        CODE evaluators run independently of Azure OpenAI.
      </div>
    </div>
  )
}
