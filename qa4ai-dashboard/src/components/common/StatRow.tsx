interface Props {
  label:    string
  value:    string | number
  unit?:    string
  color?:   string
  muted?:   boolean
}

export default function StatRow({ label, value, unit, color, muted }: Props) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-border last:border-0">
      <span className={`text-xs ${muted ? 'text-fg-subtle' : 'text-fg-muted'}`}>{label}</span>
      <span
        className="text-xs tabular-nums font-medium"
        style={color ? { color } : undefined}
      >
        {value}{unit && <span className="text-fg-subtle ml-0.5">{unit}</span>}
      </span>
    </div>
  )
}
