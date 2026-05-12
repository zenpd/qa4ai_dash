import { scoreColor } from '../../api/prometheus'

interface Props {
  name:      string
  score:     number   // 0-1 float
  threshold?: number  // 0-1 float, defaults to 0.85
  onClick?:  () => void
}

export default function EvalBar({ name, score, threshold = 0.85, onClick }: Props) {
  const pct   = Math.min(100, score * 100)
  const color = scoreColor(score, threshold)
  const pass  = score >= threshold

  return (
    <div
      className={`flex items-center gap-3 py-1.5 ${onClick ? 'cursor-pointer hover:bg-canvas-subtle rounded px-2 -mx-2 transition-colors' : ''}`}
      onClick={onClick}
    >
      {/* Evaluator name */}
      <div className="w-44 text-xs text-fg-muted truncate flex-shrink-0" title={name}>{name}</div>

      {/* Bar track */}
      <div className="flex-1 h-2.5 bg-canvas-subtle rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>

      {/* Threshold line (visual overlay) */}
      <div
        className="absolute h-4 w-px bg-fg-subtle opacity-30"
        style={{ left: `${threshold * 100}%` }}
      />

      {/* Score label */}
      <div className="w-14 text-xs tabular-nums text-right" style={{ color }}>
        {pct.toFixed(1)}%
      </div>

      {/* Pass/Fail pill */}
      <div className={`text-xs px-1.5 py-0.5 rounded ${pass ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger'}`}>
        {pass ? 'PASS' : 'FAIL'}
      </div>
    </div>
  )
}
