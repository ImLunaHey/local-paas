import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Activity } from 'lucide-react'
import { api, type Service } from './api'
import { useRuntime, type Instance } from './runtime'

type Field =
  | 'cpu_millis'
  | 'memory_bytes'
  | 'pids'
  | 'io_read_bytes_per_second'
  | 'io_write_bytes_per_second'
  | 'network_rx_bytes_per_second'
  | 'network_tx_bytes_per_second'
type Sample = Pick<Instance, Field> & { instance_id: string; node: string; timestamp: string }
const series: { field: Field; label: string; unit: string; scale: number }[] = [
  { field: 'cpu_millis', label: 'CPU usage', unit: 'millicores', scale: 1 },
  { field: 'memory_bytes', label: 'Memory usage', unit: 'MiB', scale: 1048576 },
  { field: 'pids', label: 'Processes', unit: 'PIDs', scale: 1 },
  { field: 'io_read_bytes_per_second', label: 'Disk read', unit: 'KiB/s', scale: 1024 },
  { field: 'io_write_bytes_per_second', label: 'Disk write', unit: 'KiB/s', scale: 1024 },
  { field: 'network_rx_bytes_per_second', label: 'Network received', unit: 'KiB/s', scale: 1024 },
  { field: 'network_tx_bytes_per_second', label: 'Network sent', unit: 'KiB/s', scale: 1024 },
]
export function MetricsViewer({ service }: { service: Service }) {
  const runtime = useRuntime(service.id)
  const [selected, setSelected] = useState('')
  const metrics = useQuery({
    queryKey: ['runtime-metrics', service.id],
    queryFn: () => api<{ samples: Sample[] }>('/services/' + service.id + '/runtime/metrics'),
    refetchInterval: 5000,
  })
  const instances = runtime.data?.instances ?? []
  const fresh = instances.filter(
    (i) =>
      (!selected || i.id === selected) &&
      i.desired_state === 'running' &&
      ['ready', 'starting'].includes(i.state),
  )
  const desired = instances.filter(
    (i) => (!selected || i.id === selected) && i.desired_state === 'running',
  )
  const all = [...(metrics.data?.samples ?? [])].sort(
    (a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp),
  )
  const samples = selected ? all.filter((s) => s.instance_id === selected) : combine(all)
  const total = (field: Field) =>
    fresh.length && fresh.every((i) => i[field] != null)
      ? fresh.reduce((sum, i) => sum + i[field]!, 0)
      : null
  return (
    <section className="panel p-6 space-y-5" aria-label="Runtime metrics">
      <div className="section-heading">
        <div>
          <h2>Runtime metrics</h2>
          <p className="text-xs text-muted mt-2">
            Measured usage · recent 15 minutes · updates every 5 seconds
          </p>
        </div>
        <span className="chip">{selected ? 'Instance view' : 'Combined view'}</span>
      </div>
      <label className="field">
        View
        <select
          aria-label="Runtime instance"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
        >
          <option value="">Combined · all reporting instances</option>
          {instances.map((i) => (
            <option key={i.id} value={i.id}>
              {i.node_name} · {i.id.slice(0, 8)} · {i.state}
            </option>
          ))}
        </select>
      </label>
      {(metrics.error || runtime.error) && (
        <p role="alert" className="error-notice">
          {(metrics.error || runtime.error)?.message}
        </p>
      )}
      <p className="text-xs text-muted">
        {fresh.length} of {desired.length} expected instances reporting. Missing measurements stay
        unavailable; combined history sums recent reporting instances, including candidates while
        they run.
      </p>
      <div className="grid sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {series.map(({ field, label, unit, scale }) => {
          const value = total(field)
          return (
            <div className="metric" key={field}>
              <div className="text-xs text-muted">{label}</div>
              <strong>
                {value == null
                  ? '—'
                  : field === 'pids'
                    ? String(value)
                    : (value / scale).toFixed(1) + ' ' + (field === 'cpu_millis' ? 'm' : unit)}
              </strong>
              <p>
                {value == null
                  ? 'No current measurement'
                  : selected
                    ? 'Instance usage'
                    : 'Combined usage'}
              </p>
            </div>
          )
        })}
      </div>
      {samples.length ? (
        <div className="grid lg:grid-cols-2 gap-4">
          {series
            .filter((s) => s.field !== 'pids')
            .map((s) => (
              <Chart key={s.field} samples={samples} {...s} />
            ))}
        </div>
      ) : (
        <div className="console-empty">
          <Activity size={24} />
          <h3>No runtime metrics yet</h3>
          <p>Measurements appear after an application instance starts.</p>
        </div>
      )}
      <p className="text-xs text-muted">
        Disk I/O counts block-device reads and writes; cached reads and tmpfs traffic may not reach
        disk. Network usage excludes loopback and includes readiness requests. Gaps indicate missing
        or stale samples.
      </p>
    </section>
  )
}
export function combine(samples: Sample[]): Sample[] {
  const buckets = new Map<number, Sample[]>()
  for (const sample of samples) {
    const time = Math.floor(Date.parse(sample.timestamp) / 5000) * 5000
    buckets.set(time, [...(buckets.get(time) ?? []), sample])
  }
  const latest = new Map<string, Sample>()
  return [...buckets.entries()]
    .sort(([a], [b]) => a - b)
    .map(([time, values]) => {
      for (const sample of values) latest.set(sample.instance_id, sample)
      const fresh = [...latest.values()].filter((s) => Date.parse(s.timestamp) >= time - 10000)
      const result = {
        instance_id: 'combined',
        node: 'combined',
        timestamp: new Date(time).toISOString(),
      } as Sample
      for (const { field } of series)
        result[field] = fresh.every((s) => s[field] != null)
          ? fresh.reduce((sum, s) => sum + s[field]!, 0)
          : null
      return result
    })
}
function Chart({
  samples,
  field,
  label,
  unit,
  scale,
}: {
  samples: Sample[]
  field: Field
  label: string
  unit: string
  scale: number
}) {
  const max = Math.max(1, ...samples.map((s) => (s[field] ?? 0) / scale))
  const start = Date.parse(samples[0].timestamp),
    end = Date.parse(samples[samples.length - 1].timestamp)
  let previous = 0
  const path = samples
    .map((s) => {
      const time = Date.parse(s.timestamp)
      if (s[field] == null) {
        previous = 0
        return ''
      }
      const move = !previous || time - previous > 20000
      previous = time
      return (
        (move ? 'M' : 'L') +
        (20 + ((time - start) / Math.max(1, end - start)) * 600) +
        ' ' +
        (125 - (s[field]! / scale / max) * 105)
      )
    })
    .join(' ')
  const title = label + ' (' + unit + ')'
  return (
    <div className="revision-row">
      <h3 className="text-xs">{title}</h3>
      <div className="text-xs text-muted mt-2">{max.toFixed(1)}</div>
      <svg viewBox="0 0 640 140" className="w-full" role="img" aria-label={title}>
        <path d="M20 125H620 M20 72H620 M20 20H620" stroke="#2c2c30" fill="none" />
        <path d={path} stroke="#ff9a62" strokeWidth="2" fill="none" />
      </svg>
      <div className="flex justify-between text-xs text-muted">
        <span>{new Date(start).toLocaleTimeString()}</span>
        <span>{new Date(end).toLocaleTimeString()}</span>
      </div>
    </div>
  )
}
