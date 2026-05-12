export default function LoadingSkeleton({ rows = 4, height = 'h-8' }: { rows?: number; height?: string }) {
  return (
    <div className="flex flex-col gap-2 animate-pulse">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className={`${height} rounded bg-canvas-subtle`} style={{ opacity: 1 - i * 0.15 }} />
      ))}
    </div>
  )
}
