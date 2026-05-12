export default function EmptyState({ message = 'No data available', sub }: { message?: string; sub?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-fg-subtle gap-2">
      <div className="text-4xl opacity-20">◌</div>
      <div className="text-sm">{message}</div>
      {sub && <div className="text-xs opacity-60">{sub}</div>}
    </div>
  )
}
