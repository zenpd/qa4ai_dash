interface Props {
  label:    string
  value:    string | number
  sub?:     string
  color?:   'success' | 'danger' | 'warning' | 'accent' | 'default'
  trend?:   'up' | 'down' | 'stable'
  onClick?: () => void
  /** undefined = neutral, true = above threshold (light green bg), false = below (light red bg) */
  passing?: boolean
}

const COLOR_MAP = {
  success: 'text-success',
  danger:  'text-danger',
  warning: 'text-warning',
  accent:  'text-accent',
  default: 'text-fg',
}

const TREND_ICON = { up: '↑', down: '↓', stable: '→' }
const TREND_COLOR = { up: 'text-success', down: 'text-danger', stable: 'text-fg-muted' }

export default function KpiCard({ label, value, sub, color = 'default', trend, onClick, passing }: Props) {
  const bgStyle =
    passing === true  ? { background: '#f0fdf4', borderColor: '#bbf7d0' } :
    passing === false ? { background: '#fef2f2', borderColor: '#fecaca' } :
    undefined

  return (
    <div
      className={`card flex flex-col gap-1 ${onClick ? 'cursor-pointer hover:border-accent/40 transition-colors' : ''}`}
      style={bgStyle}
      onClick={onClick}
    >
      <div className="text-fg-subtle text-xs">{label}</div>
      <div className={`text-2xl font-semibold tabular-nums ${COLOR_MAP[color]}`}>
        {value}
      </div>
      {(sub || trend) && (
        <div className="flex items-center gap-1.5 text-xs text-fg-subtle mt-0.5">
          {trend && (
            <span className={TREND_COLOR[trend]}>
              {TREND_ICON[trend]}
            </span>
          )}
          {sub && <span>{sub}</span>}
        </div>
      )}
    </div>
  )
}
