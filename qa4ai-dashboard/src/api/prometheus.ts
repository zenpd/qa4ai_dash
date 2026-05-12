import { useQuery } from '@tanstack/react-query'
import type { EvaluatorScore, TraceMetric, WorkflowStats, PromResult } from '../types/metrics'

// ─── Constants ────────────────────────────────────────────────────────────────

const PROM = '/api/datasources/proxy/uid/prometheus-ds/api/v1'
const STALE = 25_000          // 25s — just under 30s scrape interval
const GC    = 5 * 60_000      // 5 min cache retention

// ─── Raw fetch helpers ────────────────────────────────────────────────────────

async function promFetch(path: string): Promise<Response> {
  const res = await fetch(`${PROM}${path}`)
  if (!res.ok) throw new Error(`Prometheus HTTP ${res.status}`)
  return res
}

export async function promQuery(expr: string): Promise<PromResult[]> {
  const res = await promFetch(`/query?query=${encodeURIComponent(expr)}`)
  const json = await res.json()
  if (json.status !== 'success') throw new Error(json.error ?? 'Prometheus error')
  return (json.data?.result ?? []) as PromResult[]
}

export async function promLabelValues(metric: string, label: string): Promise<string[]> {
  const res = await promFetch(
    `/label/${encodeURIComponent(label)}/values?match[]=${encodeURIComponent(metric)}`
  )
  const json = await res.json()
  return (json.data ?? []) as string[]
}

// ─── Helper: extract first scalar value from PromResult[] ─────────────────────

export function scalar(results: PromResult[]): number {
  return results.length ? parseFloat(results[0].value[1]) : 0
}

// ─── Generic hook ─────────────────────────────────────────────────────────────

export function usePromQuery(expr: string, enabled = true) {
  return useQuery<PromResult[]>({
    queryKey: ['prom', expr],
    queryFn:  () => promQuery(expr),
    staleTime: STALE,
    gcTime:    GC,
    retry: 3,
    retryDelay: 2_000,
    retryOnMount: true,
    enabled,
  })
}

export function usePromLabelValues(metric: string, label: string) {
  return useQuery<string[]>({
    queryKey: ['prom-labels', metric, label],
    queryFn:  () => promLabelValues(metric, label),
    staleTime: 60_000,
    gcTime:    10 * 60_000,
    retry: 2,
  })
}

// ─── Domain-specific hooks ────────────────────────────────────────────────────

// Per-evaluator thresholds matching what was posted via run_evaluations.py
const EVAL_THRESHOLDS: Record<string, number> = {
  response_quality:      0.75,
  latency_quality:       0.65,
  token_efficiency:      0.70,
  // Domain-specific (populated when dedicated LLM-as-judge evals run):
  pep_accuracy:          0.95,
  fatca_accuracy:        0.95,
  aml_decision_quality:  0.90,
  escalation_quality:    0.88,
  factual_grounding:     0.85,
  kyc_quality:           0.85,
}

/** All evaluator scores, filtered by project (namespace removed — not a reliable label on all metrics) */
export function useEvaluatorScores(project = '.*') {
  const expr = `phoenix_evaluator_score{project_name=~"${project}"}`
  const { data, ...rest } = usePromQuery(expr)

  const scores: EvaluatorScore[] = (data ?? []).map((r) => {
    const evalName = r.metric.evaluator_name ?? r.metric.__name__ ?? 'unknown'
    return {
      name:      evalName,
      project:   r.metric.project_name   ?? '',
      namespace: r.metric.namespace      ?? '',
      score:     parseFloat(r.value[1]),
      threshold: EVAL_THRESHOLDS[evalName] ?? 0.80,
      label:     formatEvalName(evalName),
    }
  })

  return { scores, ...rest }
}

/** Evaluator threshold metric for pass/fail gate accuracy */
export function useEvaluatorThresholds(project = '.*') {
  const expr = `phoenix_evaluator_threshold{project_name=~"${project}"}`
  return usePromQuery(expr)
}

/** Trace counts grouped by project */
export function useTraceCounts(project = '.*') {
  const expr = `sum by (project_name) (phoenix_trace_count{project_name=~"${project}"})`
  return usePromQuery(expr)
}

/** p50 latency per project */
export function useLatencyP50(project = '.*') {
  const expr = `avg by (project_name) (phoenix_latency_ms_p50{project_name=~"${project}"})`
  return usePromQuery(expr)
}

/** p99 latency per project */
export function useLatencyP99(project = '.*') {
  const expr = `avg by (project_name) (phoenix_latency_ms_p99{project_name=~"${project}"})`
  return usePromQuery(expr)
}

/** Token usage per project */
export function useTokenUsage(project = '.*') {
  const expr = `sum by (project_name) (phoenix_token_count_total{project_name=~"${project}"})`
  return usePromQuery(expr)
}

/** Overall QE score — avg of all non-security evaluator scores */
export function useOverallQeScore(project = '.*') {
  // Exclude eval.red/blue/purple security evaluators — those live on Security page
  const expr = `avg(phoenix_evaluator_score{project_name=~"${project}",evaluator_name!~"eval\\.(red|blue|purple).+"})`
  return usePromQuery(expr)
}

/** All individual evaluator scores used to compute CI gate pass rate in-component */
export function useCiGatePassRate(project = '.*') {
  // Returns per-(project,evaluator) scores; caller computes pass fraction with per-evaluator thresholds
  const expr = `avg by (project_name, evaluator_name) (phoenix_evaluator_score{project_name=~"${project}",evaluator_name!~"eval\\.(red|blue|purple).+"})`
  return usePromQuery(expr)
}

/** Active Temporal workflows — all namespaces */
export function useWorkflowActive() {
  const expr = `sum by (namespace) (temporal_workflow_active{namespace=~".+"})`
  return usePromQuery(expr)
}

/** Completed Temporal workflows — all namespaces */
export function useWorkflowCompleted() {
  const expr = `sum by (namespace) (temporal_workflow_completed_total{namespace=~".+"})`
  return usePromQuery(expr)
}

/** Failed Temporal workflows — all namespaces */
export function useWorkflowFailed() {
  const expr = `sum by (namespace) (temporal_workflow_failed_total{namespace=~".+"})`
  return usePromQuery(expr)
}

/** Timed-out Temporal workflows — all namespaces */
export function useWorkflowTimedOut() {
  const expr = `sum by (namespace) (temporal_workflow_timed_out_total{namespace=~".+"})`
  return usePromQuery(expr)
}

/** Workflow failures (used as activity error proxy — temporal_activity_error_total does not exist) */
export function useActivityErrors() {
  const expr = `sum by (namespace) (temporal_workflow_failed_total{namespace=~".+"})`
  return usePromQuery(expr)
}

/** Span success rate (fraction of spans with statusCode=OK) — derived metric from phoenix.py */
export function useSpanSuccessRate(project = '.*') {
  const expr = `avg by (project_name) (phoenix_span_success_rate{project_name=~"${project}"})`
  return usePromQuery(expr)
}

/** LLM-span success rate (fraction of LLM spans with statusCode=OK) */
export function useLlmSuccessRate(project = '.*') {
  const expr = `avg by (project_name) (phoenix_llm_success_rate{project_name=~"${project}"})`
  return usePromQuery(expr)
}

/** Error rate (fraction of spans with statusCode=ERROR) */
export function useErrorRate(project = '.*') {
  const expr = `avg by (project_name) (phoenix_error_rate{project_name=~"${project}"})`
  return usePromQuery(expr)
}

/** Token efficiency (completion/prompt ratio, capped at 1.0) */
export function useTokenEfficiency(project = '.*') {
  const expr = `avg by (project_name) (phoenix_token_efficiency{project_name=~"${project}"})`
  return usePromQuery(expr)
}

/** Compliance scores — uses evaluator scores as compliance domain proxies (real data) */
export function useComplianceScores(project = '.*') {
  // Use all available evaluator scores as compliance signals
  const expr = `avg by (project_name, evaluator_name) (phoenix_evaluator_score{project_name=~"${project}"})`
  return usePromQuery(expr)
}

/** Security evaluators — red/blue/purple team scores from digital-onboarding */
export function useSecurityEvaluators(project = '.*') {
  // Matches eval.red.*, eval.blue.*, eval.purple.* evaluator_name labels
  // Note: namespace label is not present on security metrics — filter by project_name only
  // Use unescaped dot (wildcard) — PromQL rejects \. as invalid Go string escape sequence
  const expr = `avg by (project_name, evaluator_name) (phoenix_evaluator_score{project_name=~"${project}",evaluator_name=~"eval.(red|blue|purple).+"})`
  return usePromQuery(expr)
}

/** Maturity model score — derived from span success rate (operational health proxy) */
export function useMaturityScore(project = '.*') {
  // Use overall span success rate as a distinct governance/maturity signal
  // (separate from evaluator quality; measures operational health of the AI workflows)
  const expr = `avg(phoenix_span_success_rate{project_name=~"${project}"})`
  return usePromQuery(expr)
}

// ─── Composite hook — builds TraceMetric[] from multiple queries ──────────────

export function useTraceMetrics(project = '.*'): {
  traces: TraceMetric[]
  isLoading: boolean
  isError: boolean
} {
  const counts   = useTraceCounts(project)
  const p50      = useLatencyP50(project)
  const p99      = useLatencyP99(project)
  const tokens   = useTokenUsage(project)

  const isLoading = counts.isLoading || p50.isLoading || p99.isLoading || tokens.isLoading
  const isError   = counts.isError   || p50.isError   || p99.isError   || tokens.isError

  const byProject = new Map<string, Partial<TraceMetric>>()

  function merge(results: PromResult[] | undefined, key: keyof TraceMetric) {
    results?.forEach((r) => {
      const proj = r.metric.project_name ?? r.metric.job ?? 'unknown'
      const cur  = byProject.get(proj) ?? { project: proj }
      ;(cur as Record<string, unknown>)[key] = parseFloat(r.value[1])
      byProject.set(proj, cur)
    })
  }

  merge(counts.data, 'count')
  merge(p50.data,    'latency_p50')
  merge(p99.data,    'latency_p99')
  merge(tokens.data, 'tokens_input')

  const traces: TraceMetric[] = [...byProject.values()].map((t) => ({
    project:      t.project      ?? '',
    count:        t.count        ?? 0,
    latency_p50:  t.latency_p50  ?? 0,
    latency_p99:  t.latency_p99  ?? 0,
    tokens_input: t.tokens_input ?? 0,
    tokens_output: t.tokens_output ?? 0,
  }))

  return { traces, isLoading, isError }
}

/** Composite hook — builds WorkflowStats[] per namespace */
export function useWorkflowStats(): {
  stats: WorkflowStats[]
  isLoading: boolean
  isError: boolean
} {
  const active    = useWorkflowActive()
  const completed = useWorkflowCompleted()
  const failed    = useWorkflowFailed()
  const timedOut  = useWorkflowTimedOut()

  const isLoading = active.isLoading || completed.isLoading || failed.isLoading || timedOut.isLoading
  const isError   = active.isError   || completed.isError   || failed.isError   || timedOut.isError

  const byNs = new Map<string, Partial<WorkflowStats>>()

  function merge(results: PromResult[] | undefined, key: keyof WorkflowStats) {
    results?.forEach((r) => {
      const ns  = r.metric.namespace ?? 'default'
      const cur = byNs.get(ns) ?? { namespace: ns }
      ;(cur as Record<string, unknown>)[key] = parseFloat(r.value[1])
      byNs.set(ns, cur)
    })
  }

  merge(active.data,    'active')
  merge(completed.data, 'completed')
  merge(failed.data,    'failed')
  merge(timedOut.data,  'timed_out')

  const stats: WorkflowStats[] = [...byNs.values()].map((s) => ({
    namespace: s.namespace ?? '',
    active:    s.active    ?? 0,
    completed: s.completed ?? 0,
    failed:    s.failed    ?? 0,
    timed_out: s.timed_out ?? 0,
  }))

  return { stats, isLoading, isError }
}

// ─── Infrastructure / Resource metrics ────────────────────────────────────────
// Azure Container Apps metrics (labels: app_name, revision, replica)
// System metrics (labels: job, instance)

/** ACA CPU usage in millicores per container app */
export function useAcaCpu() {
  return usePromQuery('azure_aca_cpu_millicores')
}

/** ACA memory usage in MB per container app */
export function useAcaMemory() {
  return usePromQuery('azure_aca_memory_mb')
}

/** ACA replica count per container app */
export function useAcaReplicas() {
  return usePromQuery('azure_aca_replicas')
}

/** ACA up/down status (1=up, 0=down) per container app */
export function useAcaUp() {
  return usePromQuery('azure_aca_up')
}

/** Azure Monitor collector health (1=up, 0=down) */
export function useAcaCollectorUp() {
  return usePromQuery('azure_monitor_collector_up')
}

/** Process CPU seconds total (live from the exporter process itself) */
export function useProcessCpu() {
  return usePromQuery('process_cpu_seconds_total')
}

/** Process resident memory bytes */
export function useProcessMemory() {
  return usePromQuery('process_resident_memory_bytes')
}

/** System-level CPU usage % */
export function useSystemCpu() {
  return usePromQuery('system_cpu_usage_percent')
}

/** System-level memory usage % */
export function useSystemMemory() {
  return usePromQuery('system_memory_usage_percent')
}

/** System-level memory available in GB */
export function useSystemMemoryAvail() {
  return usePromQuery('system_memory_available_gb')
}

/** System-level disk usage % */
export function useSystemDisk() {
  return usePromQuery('system_disk_usage_percent')
}

/** Network bytes received total */
export function useNetworkRecv() {
  return usePromQuery('system_network_bytes_recv_total')
}

/** Network bytes sent total */
export function useNetworkSent() {
  return usePromQuery('system_network_bytes_sent_total')
}

/** Composite infra hook: system-level metrics as single scalars */
export function useSystemMetrics(): {
  cpu: number
  memUsed: number
  memAvailGb: number
  disk: number
  netRecv: number
  netSent: number
  isLoading: boolean
  isError: boolean
} {
  const cpu       = useSystemCpu()
  const mem       = useSystemMemory()
  const memAvail  = useSystemMemoryAvail()
  const disk      = useSystemDisk()
  const recv      = useNetworkRecv()
  const sent      = useNetworkSent()

  return {
    cpu:        scalar(cpu.data      ?? []),
    memUsed:    scalar(mem.data      ?? []),
    memAvailGb: scalar(memAvail.data ?? []),
    disk:       scalar(disk.data     ?? []),
    netRecv:    scalar(recv.data     ?? []),
    netSent:    scalar(sent.data     ?? []),
    isLoading:  cpu.isLoading || mem.isLoading || disk.isLoading,
    isError:    cpu.isError   || mem.isError   || disk.isError,
  }
}

/** ACA per-app infra summary */
export interface AcaApp {
  name:     string
  cpu:      number
  memory:   number
  replicas: number
  up:       boolean
}

export function useAcaApps(): { apps: AcaApp[]; isLoading: boolean; isError: boolean } {
  const cpuQ  = useAcaCpu()
  const memQ  = useAcaMemory()
  const repQ  = useAcaReplicas()
  const upQ   = useAcaUp()

  const isLoading = cpuQ.isLoading || memQ.isLoading || repQ.isLoading || upQ.isLoading
  const isError   = cpuQ.isError   || memQ.isError   || repQ.isError   || upQ.isError

  const byApp = new Map<string, Partial<AcaApp>>()

  function getKey(r: PromResult) {
    // ACA metrics may carry app_name, container_app_name, or job label
    return r.metric.app_name ?? r.metric.container_app_name ?? r.metric.job ?? r.metric.instance ?? 'unknown'
  }

  function merge(results: PromResult[] | undefined, key: keyof AcaApp, transform?: (v: number) => number) {
    results?.forEach((r) => {
      const k   = getKey(r)
      const cur = byApp.get(k) ?? { name: k }
      const val = parseFloat(r.value[1])
      ;(cur as Record<string, unknown>)[key] = transform ? transform(val) : val
      byApp.set(k, cur)
    })
  }

  merge(cpuQ.data, 'cpu')
  merge(memQ.data, 'memory')
  merge(repQ.data, 'replicas')
  upQ.data?.forEach((r) => {
    const k   = getKey(r)
    const cur = byApp.get(k) ?? { name: k }
    cur.up    = parseFloat(r.value[1]) >= 1
    byApp.set(k, cur)
  })

  const apps: AcaApp[] = [...byApp.values()].map((a) => ({
    name:     a.name     ?? 'unknown',
    cpu:      a.cpu      ?? 0,
    memory:   a.memory   ?? 0,
    replicas: a.replicas ?? 0,
    up:       a.up       ?? false,
  }))

  return { apps, isLoading, isError }
}

/** Canceled Temporal workflows — all namespaces */
export function useWorkflowCanceled() {
  const expr = `sum by (namespace) (temporal_workflow_canceled_total{namespace=~".+"})`
  return usePromQuery(expr)
}

// ─── Label discovery ──────────────────────────────────────────────────────────

export function useProjectNames() {
  // Use trace_count which is always populated (evaluator_score may be empty initially)
  return usePromLabelValues('phoenix_trace_count', 'project_name')
}

export function useNamespaces() {
  return usePromLabelValues('temporal_workflow_active', 'namespace')
}

export function useEvaluatorNames(project = '.*') {
  return usePromLabelValues(
    `phoenix_evaluator_score{project_name=~"${project}"}`,
    'evaluator_name'
  )
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function formatEvalName(raw: string): string {
  return raw.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

export function pct(v: number): string {
  return `${(v * 100).toFixed(1)}%`
}

export function scoreColor(score: number, threshold = 0.85): string {
  if (score >= threshold)           return '#3fb950'  // success
  if (score >= threshold * 0.85)    return '#d29922'  // warning  
  return '#f85149'                                     // danger
}
