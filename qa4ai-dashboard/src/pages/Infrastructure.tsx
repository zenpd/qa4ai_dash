import {
  useSystemMetrics,
  useAcaApps,
  useAcaCollectorUp,
  useProcessCpu,
  useProcessMemory,
  useNetworkRecv,
  useNetworkSent,
  scalar,
} from '../api/prometheus'
import KpiCard from '../components/common/KpiCard'
import StatRow from '../components/common/StatRow'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Cell,
} from 'recharts'

const TOOLTIP_STYLE = {
  contentStyle: { background: '#ffffff', border: '1px solid #d0d7de', borderRadius: 6 },
  labelStyle:   { color: '#24292f' },
}

function gauge(value: number, warn = 70, crit = 85): 'success' | 'warning' | 'danger' {
  return value >= crit ? 'danger' : value >= warn ? 'warning' : 'success'
}

function fmtBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`
  if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(1)} KB`
  return `${bytes.toFixed(0)} B`
}

export default function Infrastructure() {
  const sys           = useSystemMetrics()
  const collectorUpQ  = useAcaCollectorUp()
  const processCpuQ   = useProcessCpu()
  const processMemQ   = useProcessMemory()
  const netRecvQ      = useNetworkRecv()
  const netSentQ      = useNetworkSent()
  const { apps, isLoading: appsLoading } = useAcaApps()

  const collectorUp   = scalar(collectorUpQ.data ?? []) >= 1
  const processCpu    = scalar(processCpuQ.data ?? [])
  const processMem    = scalar(processMemQ.data ?? [])
  const netRecv       = scalar(netRecvQ.data ?? [])
  const netSent       = scalar(netSentQ.data ?? [])

  // Gauge bar data for system resources
  const gaugeData = [
    { name: 'CPU', value: sys.cpu, color: sys.cpu >= 85 ? '#f85149' : sys.cpu >= 70 ? '#d29922' : '#3fb950' },
    { name: 'Memory', value: sys.memUsed, color: sys.memUsed >= 85 ? '#f85149' : sys.memUsed >= 70 ? '#d29922' : '#58a6ff' },
    { name: 'Disk', value: sys.disk, color: sys.disk >= 90 ? '#f85149' : sys.disk >= 75 ? '#d29922' : '#3fb950' },
  ]

  return (
    <div className="p-5 flex flex-col gap-5">

      {/* ── System Resource KPIs ── */}
      <div>
        <div className="text-xs text-fg-muted font-medium mb-2">Host System Resources</div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <KpiCard
            label="CPU Usage"
            value={sys.cpu > 0 ? `${sys.cpu.toFixed(1)}%` : 'Loading…'}
            color={sys.cpu > 0 ? gauge(sys.cpu) : 'default'}
          />
          <KpiCard
            label="Memory Used"
            value={sys.memUsed > 0 ? `${sys.memUsed.toFixed(1)}%` : 'Loading…'}
            color={sys.memUsed > 0 ? gauge(sys.memUsed) : 'default'}
          />
          <KpiCard
            label="Disk Usage"
            value={sys.disk > 0 ? `${sys.disk.toFixed(1)}%` : 'Loading…'}
            color={sys.disk > 0 ? gauge(sys.disk, 75, 90) : 'default'}
          />
          <KpiCard
            label="Free Memory"
            value={sys.memAvailGb > 0 ? `${sys.memAvailGb.toFixed(1)} GB` : 'Loading…'}
            color="default"
          />
        </div>
      </div>

      {/* ── Charts: system gauge + process metrics ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

        {/* Resource utilisation bar chart */}
        <div className="card flex flex-col gap-3">
          <div className="text-xs text-fg-muted font-medium">Resource Utilisation (%)</div>
          {sys.isLoading ? (
            <div className="h-32 flex items-center justify-center text-xs text-fg-subtle">Loading…</div>
          ) : (
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={gaugeData} margin={{ left: 0, right: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e1e4e8" vertical={false} />
                <XAxis dataKey="name" tick={{ fill: '#57606a', fontSize: 11 }} />
                <YAxis domain={[0, 100]} tick={{ fill: '#57606a', fontSize: 10 }} tickFormatter={(v) => `${v}%`} />
                <Tooltip {...TOOLTIP_STYLE} formatter={(v: number) => [`${v.toFixed(1)}%`]} />
                <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={48}>
                  {gaugeData.map((entry) => (
                    <Cell key={entry.name} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Process-level metrics (always live from the exporter) */}
        <div className="card flex flex-col gap-3">
          <div className="text-xs text-fg-muted font-medium">Exporter Process Metrics</div>
          <StatRow label="Process CPU (total seconds)" value={processCpu > 0 ? `${processCpu.toFixed(1)} s` : '—'} />
          <StatRow label="Process Resident Memory"     value={processMem > 0 ? fmtBytes(processMem) : '—'} />
          <StatRow label="Network Received (total)"    value={netRecv > 0 ? fmtBytes(netRecv) : '—'} />
          <StatRow label="Network Sent (total)"        value={netSent > 0 ? fmtBytes(netSent) : '—'} />
          <StatRow label="Mem Available"               value={sys.memAvailGb > 0 ? `${sys.memAvailGb.toFixed(2)} GB` : '—'} />

          <div className="mt-2 pt-2 border-t border-border">
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${collectorUp ? 'bg-success' : 'bg-danger'}`} />
              <span className="text-xs text-fg-muted">
                Azure Monitor Collector: <span className={collectorUp ? 'text-success' : 'text-danger'}>
                  {collectorUpQ.isLoading ? 'checking…' : collectorUp ? 'UP' : 'DOWN'}
                </span>
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ── ACA section — only shown when collector is online ── */}
      {collectorUp && (
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <div className="text-xs text-fg-muted font-medium">Azure Container Apps</div>
        </div>

        {appsLoading && <div className="text-xs text-fg-subtle">Loading container apps…</div>}

        {!appsLoading && apps.length === 0 && (
          <div className="text-xs text-fg-subtle">No container app data returned by Prometheus.</div>
        )}

        {!appsLoading && apps.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-fg-subtle">
                  <th className="text-left py-2 pr-4 font-medium">App</th>
                  <th className="text-right py-2 pr-4 font-medium">Status</th>
                  <th className="text-right py-2 pr-4 font-medium">Replicas</th>
                  <th className="text-right py-2 pr-4 font-medium">CPU (mcores)</th>
                  <th className="text-right py-2 font-medium">Memory (MB)</th>
                </tr>
              </thead>
              <tbody>
                {[...apps]
                  .sort((a, b) => Number(b.up) - Number(a.up) || b.cpu - a.cpu)
                  .map((app) => (
                    <tr key={app.name} className="border-b border-border/30 hover:bg-canvas-overlay/30">
                      <td className="py-1.5 pr-4 text-fg font-mono">{app.name}</td>
                      <td className="py-1.5 pr-4 text-right">
                        <span className={`pill ${app.up ? 'pill-success' : 'pill-danger'}`}>
                          {app.up ? 'UP' : 'DOWN'}
                        </span>
                      </td>
                      <td className="py-1.5 pr-4 text-right text-fg-subtle">{app.replicas}</td>
                      <td className="py-1.5 pr-4 text-right" style={{ color: app.cpu > 900 ? '#cf222e' : app.cpu > 700 ? '#9a6700' : '#57606a' }}>
                        {app.cpu.toFixed(0)}
                      </td>
                      <td className="py-1.5 text-right" style={{ color: app.memory > 400 ? '#cf222e' : app.memory > 250 ? '#9a6700' : '#57606a' }}>
                        {app.memory.toFixed(0)}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      )}
    </div>
  )
}
