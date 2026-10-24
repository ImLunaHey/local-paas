import { Trend } from './trend'
import { Select } from './components/select'
import { Field } from './components/field'
import { useMemo, useState } from 'react'
import { defineChart, lineY } from '@tanstack/charts'
import { Chart as TanStackChart } from '@tanstack/charts/react'
import { scaleLinear } from '@tanstack/charts/scales/linear'
import { tooltip } from '@tanstack/charts/tooltip'
import { useQuery } from '@tanstack/react-query'
import { Activity } from 'lucide-react'
import { api } from './api-client'
import type { Service } from './generated/model/service'
import { useRuntime, type Instance } from './runtime-query'

type Field =
  | 'cpuMillis'
  | 'memoryBytes'
  | 'pids'
  | 'ioReadBytesPerSecond'
  | 'ioWriteBytesPerSecond'
  | 'networkRxBytesPerSecond'
  | 'networkTxBytesPerSecond'
type Sample = Pick<Instance, Field> & { instanceId: string; node: string; timestamp: string }
const series: { field: Field; label: string; unit: string; scale: number }[] = [
  { field: 'cpuMillis', label: 'CPU usage', unit: 'millicores', scale: 1 },
  { field: 'memoryBytes', label: 'Memory usage', unit: 'MiB', scale: 1048576 },
  { field: 'pids', label: 'Processes', unit: 'PIDs', scale: 1 },
  { field: 'ioReadBytesPerSecond', label: 'Disk read', unit: 'KiB/s', scale: 1024 },
  { field: 'ioWriteBytesPerSecond', label: 'Disk write', unit: 'KiB/s', scale: 1024 },
  { field: 'networkRxBytesPerSecond', label: 'Network received', unit: 'KiB/s', scale: 1024 },
  { field: 'networkTxBytesPerSecond', label: 'Network sent', unit: 'KiB/s', scale: 1024 },
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
      i.desiredState === 'running' &&
      ['ready', 'starting'].includes(i.state),
  )
  const desired = instances.filter(
    (i) => (!selected || i.id === selected) && i.desiredState === 'running',
  )
  const all = [...(metrics.data?.samples ?? [])].sort(
    (a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp),
  )
  const samples = selected ? all.filter((s) => s.instanceId === selected) : combine(all)
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
      <Field label="View">
        <Select
          aria-label="Runtime instance"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
        >
          <option value="">Combined · all reporting instances</option>
          {instances.map((i) => (
            <option key={i.id} value={i.id}>
              {i.nodeName} · {i.id.slice(0, 8)} · {i.state}
            </option>
          ))}
        </Select>
      </Field>
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
                    : (value / scale).toFixed(1) + ' ' + (field === 'cpuMillis' ? 'm' : unit)}
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
function combine(samples: Sample[]): Sample[] {
  const buckets = new Map<number, Sample[]>()
  for (const sample of samples) {
    const time = Math.floor(Date.parse(sample.timestamp) / 5000) * 5000
    buckets.set(time, [...(buckets.get(time) ?? []), sample])
  }
  const latest = new Map<string, Sample>()
  return [...buckets.entries()]
    .sort(([a], [b]) => a - b)
    .map(([time, values]) => {
      for (const sample of values) latest.set(sample.instanceId, sample)
      const fresh = [...latest.values()].filter((s) => Date.parse(s.timestamp) >= time - 10000)
      const result = {
        instanceId: 'combined',
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
  const definition = useMemo(() => {
    const points: { time: number; value: number | null; node: string }[] = []
    for (const sample of samples) {
      const time = Date.parse(sample.timestamp)
      const previous = points.at(-1)
      if (previous && time - previous.time > 20000)
        points.push({ time: previous.time + 1, value: null, node: sample.node })
      points.push({
        time,
        value: sample[field] == null ? null : sample[field]! / scale,
        node: sample.node,
      })
    }
    return defineChart({
      marks: [lineY(points, { x: 'time', y: 'value', stroke: '#ff9a62', strokeWidth: 1.75 })],
      scales: {
        x: {
          scale: scaleLinear,
          axis: {
            ticks: {
              count: 3,
              format: (value) =>
                new Date(value).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
            },
          },
        },
        y: {
          scale: () =>
            scaleLinear().domain([0, Math.max(1, ...points.map((p) => p.value ?? 0)) * 1.1]),
          grid: true,
          axis: {
            ticks: {
              count: 4,
              format: (value) => value.toLocaleString(undefined, { maximumFractionDigits: 1 }),
            },
          },
        },
      },
      theme: {
        foreground: 'light-dark(#52525b,#a1a1aa)',
        muted: 'light-dark(#52525b,#81818b)',
        grid: 'light-dark(#e4e4e7,#29292f)',
        background: 'transparent',
      },
      focus: 'nearest-x',
      maxFocusDistance: Number.POSITIVE_INFINITY,
      tooltip: {
        use: tooltip,
        className: 'metric-tooltip',
        format: (point) =>
          new Date(point.datum.time).toLocaleString() +
          '\n' +
          label +
          ': ' +
          point.datum.value?.toLocaleString(undefined, { maximumFractionDigits: 2 }) +
          ' ' +
          unit +
          '\n' +
          (point.datum.node === 'combined'
            ? 'Combined · all reporting instances'
            : point.datum.node),
      },
    })
  }, [samples, field, scale, label, unit])
  return (
    <div className="revision-row metric-chart">
      <h3 className="text-xs mb-3">
        {label} ({unit})
      </h3>
      <TanStackChart definition={definition} height={180} ariaLabel={label + ' (' + unit + ')'} />
    </div>
  )
}

export function ServiceTrends({ service, instances }: { service: Service; instances: Instance[] }) {
  const metrics = useQuery({
    queryKey: ['runtime-metrics', service.id],
    queryFn: () => api<{ samples: Sample[] }>('/services/' + service.id + '/runtime/metrics'),
    refetchInterval: 10000,
    enabled: service.spec.workload.kind !== 'celld-service',
  })
  const active = instances.filter(
    (i) =>
      i.desiredState === 'running' &&
      ['ready', 'starting'].includes(i.state) &&
      i.observedAt &&
      Date.now() - Date.parse(i.observedAt) < 15000,
  )
  const ids = new Set(active.map((i) => i.id))
  const samples = combine((metrics.data?.samples ?? []).filter((s) => ids.has(s.instanceId)))
  return (
    <>
      {series.slice(0, 2).map(({ field, label, unit, scale }) => {
        const current =
          active.length && active.every((i) => i[field] != null)
            ? active.reduce((sum, i) => sum + i[field]!, 0) / scale
            : null
        return (
          <div key={field} className="service-trend min-w-0" aria-label={label}>
            <span className="block text-[10px] text-muted min-[721px]:hidden">{label}</span>
            <span className="text-[11px] text-zinc-300">
              {current == null
                ? '—'
                : current.toLocaleString(undefined, { maximumFractionDigits: 1 }) +
                  ' ' +
                  (field === 'cpuMillis' ? 'm' : unit)}
            </span>
            {samples.some((s) => s[field] != null) && !metrics.isError ? (
              <Trend
                compact
                label={label}
                unit={unit}
                points={samples.map((s) => ({
                  time: Date.parse(s.timestamp),
                  value: s[field] == null ? null : s[field]! / scale,
                }))}
              />
            ) : (
              <span className="block pt-2 text-[10px] text-muted">
                {metrics.isError ? 'Unavailable' : 'No measurements'}
              </span>
            )}
          </div>
        )
      })}
    </>
  )
}
