// ─── TypeScript types for all Prometheus/QE4AI metric shapes ──────────────────

export interface PromResult {
  metric: Record<string, string>
  value: [number, string] // [timestamp, stringValue]
}

export interface PromRangeResult {
  metric: Record<string, string>
  values: [number, string][]
}

export interface EvaluatorScore {
  name: string
  project: string
  namespace: string
  score: number         // 0-1 float
  threshold: number     // 0-1 float, pass threshold
  label: string         // display name
}

export interface WorkflowStats {
  namespace: string
  active: number
  completed: number
  failed: number
  timed_out: number
}

export interface TraceMetric {
  project: string
  count: number
  latency_p50: number   // ms
  latency_p99: number   // ms
  tokens_input: number
  tokens_output: number
}

export interface ComplianceDomain {
  name: string
  score: number         // 0-100
  total: number
  passed: number
}

export type Pillar = 'correctness' | 'reliability' | 'observability' | 'governance'

export interface PillarSummary {
  pillar: Pillar
  score: number         // 0-100
  trend: 'up' | 'down' | 'stable'
  evaluators: number
}
