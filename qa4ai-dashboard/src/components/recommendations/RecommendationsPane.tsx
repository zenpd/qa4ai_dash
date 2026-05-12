import { useFilters } from '../../store/filters'
import {
  useOverallQeScore,
  useCiGatePassRate,
  useMaturityScore,
  useTraceCounts,
  useWorkflowActive,
  scalar,
} from '../../api/prometheus'

// Per-evaluator thresholds — must match Overview.tsx
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

interface RecItem {
  id:        string
  label:     string
  value:     string
  threshold: string
  passing:   boolean
  priority:  'high' | 'medium' | 'low'
  actions:   string[]
}

const PRIORITY_BADGE: Record<string, string> = {
  high:   'bg-red-100 text-red-700',
  medium: 'bg-yellow-100 text-yellow-700',
  low:    'bg-green-100 text-green-700',
}

export default function RecommendationsPane({ onClose }: { onClose: () => void }) {
  const { project } = useFilters()

  const qeScore   = useOverallQeScore(project)
  const gateRate  = useCiGatePassRate(project)
  const maturity  = useMaturityScore(project)
  const traces    = useTraceCounts(project)
  const workflows = useWorkflowActive()

  const qeVal     = scalar(qeScore.data ?? [])
  const matVal    = scalar(maturity.data ?? [])
  const tracesCnt = (traces.data ?? []).reduce((s, r) => s + parseFloat(r.value[1]), 0)
  const wfActive  = (workflows.data ?? []).reduce((s, r) => s + parseFloat(r.value[1]), 0)

  const gateRows = gateRate.data ?? []
  const gatePassing = gateRows.filter((r) => {
    const th = EVAL_THRESHOLDS[r.metric.evaluator_name ?? ''] ?? DEFAULT_THRESHOLD
    return parseFloat(r.value[1]) >= th
  }).length
  const gateVal = gateRows.length > 0 ? gatePassing / gateRows.length : 0

  const isLoading = qeScore.isLoading || gateRate.isLoading || maturity.isLoading || traces.isLoading

  const items: RecItem[] = [
    {
      id:        'qe',
      label:     'Overall QE Score',
      value:     `${(qeVal * 100).toFixed(1)}%`,
      threshold: '85%',
      passing:   qeVal >= 0.85,
      priority:  qeVal < 0.5 ? 'high' : qeVal < 0.85 ? 'medium' : 'low',
      actions: [
        'Go to Correctness page → sort evaluators by score ascending → review the lowest-scoring ones first.',
        'Improve system prompts: add domain-specific context (KYC rules, AML flags, FATCA requirements) to reduce vague or hallucinated responses.',
        'Add RAG grounding: connect the LLM to a compliance knowledge base so answers are factually anchored.',
        'Run run_evaluations.py with additional evaluators: pep_accuracy, kyc_quality, factual_grounding to broaden coverage.',
        'Review Phoenix traces for low-score patterns → identify prompt templates causing failures → rewrite them.',
        'Enable Phoenix span annotations: manually label poor responses to build an evaluation dataset for fine-tuning.',
      ],
    },
    {
      id:        'gate',
      label:     'CI Gate Pass Rate',
      value:     gateRows.length > 0 ? `${gatePassing}/${gateRows.length} evaluators (${(gateVal * 100).toFixed(1)}%)` : '—',
      threshold: '90% evaluators passing',
      passing:   gateVal >= 0.90,
      priority:  gateVal < 0.6 ? 'high' : gateVal < 0.9 ? 'medium' : 'low',
      actions: [
        'Add evaluation gate in azure-pipelines-be.yml: run run_evaluations.py as a build step and fail the pipeline if pass rate < 90%.',
        'Go to Correctness page → sort by score → fix the top 2–3 failing evaluators before the next deployment.',
        'Align EVAL_THRESHOLDS values in prometheus.ts with your production SLA — lower-stakes evaluators may warrant less strict thresholds.',
        'For each failing evaluator, check the specific spans in Phoenix UI (filter by evaluator_name) to find the root-cause prompt patterns.',
        'Add a deployment guard script: require response_quality mean ≥ 0.75 before az containerapp update is executed.',
        'Configure ACA blue-green revisions to validate new model versions against evaluation gates before receiving full traffic.',
      ],
    },
    {
      id:        'maturity',
      label:     'AI Maturity Score',
      value:     matVal > 0 ? `${(matVal * 100).toFixed(1)}%` : 'No span data',
      threshold: '60% span success rate',
      passing:   matVal >= 0.60,
      priority:  matVal < 0.3 ? 'high' : matVal < 0.6 ? 'medium' : 'low',
      actions: [
        'In Phoenix UI, filter spans by statusCode=ERROR → identify the service and activity generating errors.',
        'Add try/except in Temporal workflow activities: catch LLM API exceptions and record them as WARN-level spans instead of ERROR.',
        'Implement retry logic with exponential backoff: wrap all LLM calls with tenacity (max_attempts=3, wait_exponential).',
        'Check Azure OpenAI endpoint for throttling: az monitor metrics list --resource <openai-resource> → look for 429 rate limit events.',
        'Instrument all workflow activities with @traced decorator in phoenix_client to capture success/failure at the span level.',
        'Add a health-check Temporal activity that pings the LLM endpoint and raises an alert if latency > 10 seconds.',
      ],
    },
    {
      id:        'traces',
      label:     'Total Traces',
      value:     tracesCnt.toFixed(0),
      threshold: '≥ 100 for reliable stats',
      passing:   tracesCnt >= 100,
      priority:  tracesCnt < 10 ? 'high' : tracesCnt < 50 ? 'medium' : 'low',
      actions: [
        'Set the PHOENIX_COLLECTOR_ENDPOINT env var in all container apps and verify it points to the Phoenix ingest endpoint.',
        'Add @traced decorators to all Temporal workflow activities in digital-onboarding/app/workflows/ to capture every LLM operation.',
        'Run end-to-end onboarding test flows to generate representative traces: cd digital-onboarding && python -m pytest tests/e2e/ -v',
        'Add a scheduled Azure Pipelines task to run synthetic load tests (10–20 flows/hour) to maintain continuous trace volume.',
        'Check Phoenix dashboard → Projects → verify traceCount is growing after each run; if not, check OTEL exporter config.',
      ],
    },
    {
      id:        'workflows',
      label:     'Active Workflows',
      value:     wfActive.toFixed(0),
      threshold: '≥ 1 running',
      passing:   wfActive >= 1,
      priority:  wfActive === 0 ? 'high' : 'low',
      actions: [
        'Check Temporal worker status: az containerapp show -n temporal-worker --resource-group Zenlabs-Agent-Foundry --query properties.runningStatus',
        'Open Temporal UI (sidebar → Grafana Dashboards → Temporal) → Workflows → verify there are active or recent workflows.',
        'Restart worker if stopped: az containerapp update -n temporal-worker -g Zenlabs-Agent-Foundry --revision-suffix restart$(date +%s)',
        'Verify TEMPORAL_NAMESPACE and TEMPORAL_ADDRESS env vars are correctly set in the worker container app.',
        'Check worker logs: az containerapp logs show -n temporal-worker -g Zenlabs-Agent-Foundry --follow to see connection errors.',
      ],
    },
  ]

  const failing = items.filter((i) => !i.passing)
  const passing = items.filter((i) => i.passing)
  const allGood = failing.length === 0

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-3 border-b border-border bg-canvas-overlay flex-shrink-0">
        <div>
          <div className="text-xs font-semibold text-fg-default">💡 Recommendations</div>
          {!isLoading && (
            <div className="text-xs text-fg-subtle mt-0.5">
              {failing.length === 0 ? 'All metrics healthy' : `${failing.length} metric${failing.length > 1 ? 's' : ''} need attention`}
            </div>
          )}
        </div>
        <button
          onClick={onClose}
          className="text-fg-subtle hover:text-fg-default text-xs px-2 py-1 rounded hover:bg-canvas-subtle transition-colors"
          title="Back to navigation"
        >
          ✕
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-2 py-2 flex flex-col gap-2">
        {isLoading ? (
          <div className="text-xs text-fg-subtle text-center py-6">Loading metrics…</div>
        ) : allGood ? (
          <div className="flex flex-col items-center justify-center gap-2 py-8">
            <div className="text-2xl">🎉</div>
            <div className="text-xs font-medium text-success text-center">All metrics are above threshold!</div>
            <div className="text-xs text-fg-subtle text-center">Continue running evaluations to maintain quality.</div>
          </div>
        ) : (
          <>
            {/* Failing metrics */}
            {failing.map((item) => (
              <div
                key={item.id}
                className="rounded-lg border p-2.5"
                style={{ borderColor: '#fecaca', background: '#fff5f5' }}
              >
                <div className="flex items-start justify-between gap-1 mb-1.5">
                  <div>
                    <div className="text-xs font-semibold text-fg-default leading-tight">{item.label}</div>
                    <div className="text-xs text-fg-subtle mt-0.5">
                      <span className="font-medium text-danger">{item.value}</span>
                      <span className="mx-1">·</span>
                      <span>target {item.threshold}</span>
                    </div>
                  </div>
                  <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded flex-shrink-0 ${PRIORITY_BADGE[item.priority]}`}>
                    {item.priority}
                  </span>
                </div>
                <ol className="flex flex-col gap-1">
                  {item.actions.map((action, i) => (
                    <li key={i} className="flex gap-1.5 text-[10.5px] leading-snug text-fg-default">
                      <span className="flex-shrink-0 font-semibold text-danger mt-px">{i + 1}.</span>
                      <span>{action}</span>
                    </li>
                  ))}
                </ol>
              </div>
            ))}

            {/* Passing metrics summary */}
            {passing.length > 0 && (
              <div className="mt-1">
                <div className="text-[10px] font-medium text-fg-subtle mb-1 px-0.5 uppercase tracking-wide">Passing</div>
                {passing.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between rounded px-2 py-1.5 mb-1"
                    style={{ background: '#f0fdf4', borderColor: '#bbf7d0', border: '1px solid #bbf7d0' }}
                  >
                    <span className="text-xs text-fg-default">{item.label}</span>
                    <span className="text-xs font-semibold text-success">{item.value} ✓</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
