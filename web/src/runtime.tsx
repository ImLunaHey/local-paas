import { useEffect, useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Activity,
  Box,
  ExternalLink,
  LoaderCircle,
  Pause,
  Play,
  Server,
  Terminal,
} from 'lucide-react'
import { api } from './api'
import type { Revision, Service } from './api'

export interface Instance {
  id: string
  deployment_id: string
  node_id: string
  node_name: string
  state: string
  desired_state: string
  diagnostic: string | null
  observed_at: string | null
  cpu_millis: number | null
  memory_bytes: number | null
  pids: number | null
}
interface Deployment {
  id: string
  revision_id: string
  status: string
  error_code: string | null
  created_at: string
}
export interface RuntimeStatus {
  deployments: Deployment[]
  instances: Instance[]
  healthy_nodes: number
  preview_url: string | null
}
export function useRuntime(id: string, enabled = true) {
  return useQuery({
    queryKey: ['runtime', id],
    queryFn: () => api<RuntimeStatus>(`/services/${id}/runtime`),
    refetchInterval: 3000,
    enabled,
  })
}
export function runtimeLabel(data?: RuntimeStatus): string {
  if (!data) return 'Checking runtime'
  const active = data.deployments.find((d) => d.status === 'active')
  if (active)
    return data.instances.some((i) => i.deployment_id === active.id && i.state === 'ready')
      ? 'Running'
      : 'Unavailable'
  if (data.deployments.some((d) => d.status === 'preparing')) return 'Deploying'
  if (data.deployments[0]?.status === 'failed') return 'Deployment failed'
  return data.deployments.length ? 'Stopped' : 'Not deployed'
}
export function DeploymentPanel({ service }: { service: Service }) {
  const client = useQueryClient()
  const runtime = useRuntime(service.id)
  const revisions = useQuery({
    queryKey: ['revisions', service.id],
    queryFn: () => api<Revision[]>(`/services/${service.id}/revisions`),
    enabled: service.spec.workload.kind === 'oci-service',
  })
  const [chosen, setChosen] = useState('')
  const revision = chosen || revisions.data?.[0]?.id || ''
  const operation = useRef<{ revision: string; id: string } | null>(null)
  const deploy = useMutation({
    mutationFn: () => {
      if (operation.current?.revision !== revision)
        operation.current = { revision, id: crypto.randomUUID() }
      return api(`/services/${service.id}/deployments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operation_id: operation.current.id, revision_id: revision }),
      })
    },
    onSuccess: async () => {
      operation.current = null
      await client.invalidateQueries({ queryKey: ['runtime', service.id] })
    },
  })
  const stop = useMutation({
    mutationFn: (id: string) => api(`/deployments/${id}/stop`, { method: 'POST' }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['runtime', service.id] })
    },
  })
  if (service.spec.workload.kind !== 'oci-service') return null
  const preparing = runtime.data?.deployments.some((d) => d.status === 'preparing')
  return (
    <section className="panel p-6 mb-7 space-y-4" aria-label="Deployments">
      <div className="section-heading">
        <h2>Deployments</h2>
        <span className="chip">{runtime.data?.healthy_nodes ?? '—'} available workers</span>
      </div>
      <p className="text-xs text-muted">
        Deploy an image revision. Traffic switches after every candidate passes readiness; the
        previous healthy deployment stays available until then.
      </p>
      <div className="flex flex-wrap gap-3 items-end">
        <label className="field flex-1 min-w-0">
          Image revision
          <select
            aria-label="Deployment revision"
            className="build-select mt-2"
            value={revision}
            onChange={(e) => setChosen(e.target.value)}
          >
            {!revisions.data?.length && <option value="">No built revisions</option>}
            {revisions.data?.map((r) => (
              <option key={r.id} value={r.id}>
                {new Date(r.created_at).toLocaleString()} · {r.image_digest.slice(0, 19)}
              </option>
            ))}
          </select>
        </label>
        <button
          className="button primary"
          onClick={() => deploy.mutate()}
          disabled={
            !revision ||
            !runtime.data?.healthy_nodes ||
            preparing ||
            deploy.isPending ||
            runtime.isError
          }
        >
          {deploy.isPending ? (
            <LoaderCircle size={14} className="animate-spin" />
          ) : (
            <Play size={14} />
          )}{' '}
          Deploy revision
        </button>
      </div>
      {(deploy.isError || stop.isError || runtime.isError || revisions.isError) && (
        <p role="alert" className="error-notice">
          {(deploy.error || stop.error || runtime.error || revisions.error)?.message}
        </p>
      )}
      {runtime.data?.deployments.slice(0, 5).map((d) => (
        <div key={d.id} className="revision-row flex flex-wrap items-center justify-between gap-3">
          <div>
            <span className="chip" data-state={d.status === 'active' ? 'succeeded' : d.status}>
              {d.status}
            </span>
            <code className="text-xs ml-3">{d.id.slice(0, 8)}</code>
            <p className="text-xs text-muted mt-2">
              {new Date(d.created_at).toLocaleString()}
              {d.error_code && ` · ${d.error_code.replaceAll('_', ' ')}`}
            </p>
          </div>
          {['preparing', 'active'].includes(d.status) && (
            <button className="button" disabled={stop.isPending} onClick={() => stop.mutate(d.id)}>
              Stop deployment
            </button>
          )}
        </div>
      ))}
      {runtime.data?.preview_url && runtimeLabel(runtime.data) === 'Running' && (
        <a className="back-link" href={runtime.data.preview_url} target="_blank" rel="noreferrer">
          Open application <ExternalLink size={14} />
        </a>
      )}
    </section>
  )
}
interface Log {
  sequence: number
  instance_id: string
  node: string
  revision_id: string
  timestamp: string
  stream: string
  line: string
}
interface LogPage {
  entries: Log[]
  next_cursor: number
}
interface Sample {
  instance_id: string
  node: string
  timestamp: string
  cpu_millis: number
  memory_bytes: number
  pids: number
}
export function RuntimePanel({ service, view }: { service: Service; view: 'logs' | 'metrics' }) {
  const runtime = useRuntime(service.id)
  const client = useQueryClient()
  const [selected, setSelected] = useState('')
  const [paused, setPaused] = useState(false)
  const consoleRef = useRef<HTMLDivElement>(null)
  const follow = useRef(true)
  const logsKey = ['runtime-logs', service.id, selected]
  const logs = useQuery({
    queryKey: logsKey,
    enabled: view === 'logs' && !paused,
    queryFn: async () => {
      let previous = client.getQueryData<LogPage>(logsKey) ?? { entries: [], next_cursor: 0 }
      for (let page = 0; page < 4; page++) {
        const result = await api<LogPage>(
          `/services/${service.id}/runtime/logs?after=${previous.next_cursor}${selected ? `&instance_id=${selected}` : ''}`,
        )
        previous = {
          entries: [...previous.entries, ...result.entries].slice(-500),
          next_cursor: result.next_cursor,
        }
        if (result.entries.length < 256) break
      }
      return previous
    },
    refetchInterval: paused ? false : 3000,
  })
  const metrics = useQuery({
    queryKey: ['runtime-metrics', service.id],
    queryFn: () => api<{ samples: Sample[] }>(`/services/${service.id}/runtime/metrics`),
    enabled: view === 'metrics',
    refetchInterval: 5000,
  })
  useEffect(() => {
    const element = consoleRef.current
    if (element && follow.current && !paused) element.scrollTop = element.scrollHeight
  }, [logs.data?.next_cursor, paused])
  const instances = runtime.data?.instances ?? []
  const current =
    instances.find((i) => i.id === selected) ??
    instances.find((i) => i.desired_state === 'running') ??
    instances[0]
  const fresh = current && ['ready', 'starting'].includes(current.state)
  const samples = metrics.data?.samples.filter((s) => s.instance_id === current?.id).reverse() ?? []
  const label = runtime.isError ? 'Disconnected' : runtimeLabel(runtime.data)
  const error = runtime.error || (view === 'logs' ? logs.error : metrics.error)
  return (
    <section
      className="panel p-6 space-y-5"
      aria-label={view === 'logs' ? 'Runtime logs' : 'Runtime metrics'}
    >
      <div className="section-heading">
        <div>
          <h2>{view === 'logs' ? 'Runtime logs' : 'Runtime metrics'}</h2>
          <p className="text-xs text-muted mt-2">
            {view === 'logs'
              ? 'Application stdout and stderr · latest 500 retained entries'
              : 'Application cgroup measurements · recent 15 minutes'}
          </p>
        </div>
        <span className="chip">{label}</span>
      </div>
      {error && (
        <p className="error-notice" role="alert">
          {error.message}
        </p>
      )}
      {instances.length > 0 && (
        <div className="flex flex-wrap gap-3 items-center">
          <select
            aria-label="Runtime instance"
            className="build-select flex-1"
            value={view === 'metrics' ? (current?.id ?? '') : selected}
            onChange={(e) => setSelected(e.target.value)}
          >
            {view === 'logs' && <option value="">All instances</option>}
            {instances.map((i) => (
              <option key={i.id} value={i.id}>
                {i.node_name} · {i.id.slice(0, 8)} · {i.state}
              </option>
            ))}
          </select>
          {view === 'logs' && (
            <button className="button" onClick={() => setPaused(!paused)}>
              {paused ? <Play size={14} /> : <Pause size={14} />}
              {paused ? 'Resume live logs' : 'Pause live logs'}
            </button>
          )}
        </div>
      )}
      {view === 'logs' ? (
        <>
          <div className="flex justify-between text-xs text-muted">
            <span>
              {paused
                ? 'Paused'
                : logs.isError
                  ? 'Disconnected'
                  : label === 'Running' || label === 'Deploying'
                    ? 'Following · updates every 3 seconds'
                    : 'Retained output'}
            </span>
            <span>512 KiB retained per instance</span>
          </div>
          {logs.data?.entries.length ? (
            <div
              className="build-log runtime-log"
              aria-label="Application output"
              ref={consoleRef}
              onScroll={(e) => {
                const element = e.currentTarget
                follow.current =
                  element.scrollHeight - element.scrollTop - element.clientHeight < 40
              }}
            >
              {logs.data.entries.map((l) => (
                <div key={l.sequence} className="runtime-log-row">
                  <span className="text-muted">
                    {new Date(l.timestamp).toLocaleTimeString()} {l.node} /{' '}
                    {l.instance_id.slice(0, 8)} {l.stream}
                  </span>
                  <pre className={l.stream === 'stderr' ? 'text-orange-300' : ''}>{l.line}</pre>
                </div>
              ))}
            </div>
          ) : (
            <div className="console-empty">
              <Terminal size={24} />
              <h3>
                {instances.length ? 'Waiting for application output' : 'No running instances'}
              </h3>
              <p>
                {instances.length
                  ? 'New stdout and stderr entries appear here as the agent reports them.'
                  : service.spec.workload.kind === 'oci-service'
                    ? 'Deploy a built image from Builds & revisions to start the application.'
                    : 'The dedicated celld fleet runtime is not implemented yet.'}
              </p>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="grid sm:grid-cols-3 gap-4">
            <Reading
              icon={<Server size={16} />}
              label="CPU usage"
              value={
                fresh && current.cpu_millis !== null ? `${current.cpu_millis.toFixed(1)}m` : '—'
              }
            />
            <Reading
              icon={<Box size={16} />}
              label="Memory usage"
              value={
                fresh && current.memory_bytes !== null
                  ? `${(current.memory_bytes / 1048576).toFixed(1)} MiB`
                  : '—'
              }
            />
            <Reading
              icon={<Activity size={16} />}
              label="Processes"
              value={fresh && current.pids !== null ? String(current.pids) : '—'}
            />
          </div>
          {!samples.length ? (
            <div className="console-empty">
              <Activity size={24} />
              <h3>No runtime metrics yet</h3>
              <p>
                {instances.length
                  ? 'Waiting for the node agent to report cgroup measurements.'
                  : 'Metrics begin after an application instance starts.'}
              </p>
            </div>
          ) : (
            <div className="grid lg:grid-cols-2 gap-4">
              <Chart samples={samples} field="cpu_millis" label="CPU usage (millicores)" />
              <Chart samples={samples} field="memory_bytes" label="Memory usage (MiB)" />
            </div>
          )}
          {current?.observed_at && (
            <p className="text-xs text-muted">
              {current.node_name} · {current.state} · last observed{' '}
              {new Date(current.observed_at).toLocaleTimeString()}
              {current.diagnostic && ` · ${current.diagnostic.replaceAll('_', ' ')}`}
            </p>
          )}
        </>
      )}
      {!instances.length && service.spec.workload.kind === 'oci-service' && (
        <Link
          className="back-link"
          to="/services/$serviceId/builds"
          params={{ serviceId: service.id }}
        >
          View build output
        </Link>
      )}
    </section>
  )
}
function Reading({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="metric">
      <div className="flex justify-between text-xs text-muted">
        {label}
        {icon}
      </div>
      <strong>{value}</strong>
      <p>Observed usage</p>
    </div>
  )
}
function Chart({
  samples,
  field,
  label,
}: {
  samples: Sample[]
  field: 'cpu_millis' | 'memory_bytes'
  label: string
}) {
  const values = samples.map((s) => (field === 'memory_bytes' ? s[field] / 1048576 : s[field]))
  const max = Math.max(1, ...values)
  const start = Date.parse(samples[0].timestamp),
    end = Date.parse(samples[samples.length - 1].timestamp)
  const points = values
    .map(
      (v, i) =>
        `${20 + ((Date.parse(samples[i].timestamp) - start) / Math.max(1, end - start)) * 600},${125 - (v / max) * 105}`,
    )
    .join(' ')
  return (
    <div className="revision-row">
      <h3 className="text-xs">{label}</h3>
      <div className="text-xs text-muted mt-2">{max.toFixed(1)}</div>
      {samples.length > 1 ? (
        <svg viewBox="0 0 640 140" className="w-full" role="img" aria-label={label}>
          <path d="M20 125H620 M20 72H620 M20 20H620" stroke="#2c2c30" fill="none" />
          <polyline points={points} stroke="#ff9a62" strokeWidth="2" fill="none" />
        </svg>
      ) : (
        <p className="text-xs text-muted py-10">Waiting for another sample…</p>
      )}
      <div className="flex justify-between text-xs text-muted">
        <span>{new Date(start).toLocaleTimeString()}</span>
        <span>{new Date(end).toLocaleTimeString()}</span>
      </div>
    </div>
  )
}
