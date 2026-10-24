import { PreDeployResult, type ReleaseJob } from './release-job'
import { Button, Select, Field } from './ui'
import { LogViewer } from './logs'
import { MetricsViewer } from './metrics'
import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, LoaderCircle, Play } from 'lucide-react'
import { api } from './api'
import type { Revision, Service } from './api'

export interface Instance {
  id: string
  deploymentId: string
  nodeId: string
  nodeName: string
  state: string
  desiredState: string
  diagnostic: string | null
  observedAt: string | null
  cpuMillis: number | null
  memoryBytes: number | null
  pids: number | null
  ioReadBytesPerSecond: number | null
  ioWriteBytesPerSecond: number | null
  networkRxBytesPerSecond: number | null
  networkTxBytesPerSecond: number | null
}
interface Deployment {
  preDeploy?: ReleaseJob | null
  id: string
  revisionId: string
  status: string
  errorCode: string | null
  createdAt: string
}
export interface RuntimeStatus {
  deployments: Deployment[]
  instances: Instance[]
  healthyNodes: number
  previewUrl: string | null
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
    return data.instances.some((i) => i.deploymentId === active.id && i.state === 'ready')
      ? 'Running'
      : 'Unavailable'
  const waiting = data.deployments.find((d) => d.status === 'waiting')
  if (waiting)
    return waiting.errorCode === 'waiting_for_capacity'
      ? 'Waiting for capacity'
      : 'Waiting for shutdown'
  if (data.deployments.some((d) => d.status === 'releasing')) return 'Pre-deploy task'
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
    enabled: service.spec.workload.kind !== 'celld-service',
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
        body: JSON.stringify({ operationId: operation.current.id, revisionId: revision }),
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
  if (service.spec.workload.kind === 'celld-service') return null
  const worker =
    service.spec.workload.kind === 'oci-service' && service.spec.workload.execution === 'worker'
  const preparing = runtime.data?.deployments.some((d) =>
    ['releasing', 'waiting', 'preparing'].includes(d.status),
  )
  return (
    <section className="panel p-6 mb-7 space-y-4" aria-label="Deployments">
      <div className="section-heading">
        <h2>Deployments</h2>
        <span className="chip">{runtime.data?.healthyNodes ?? '—'} available workers</span>
      </div>
      <p className="text-xs text-muted">
        {worker
          ? 'Deploying stops the previous worker first. Its replacement waits for confirmed shutdown, including when the old node is unreachable. A failed replacement requires another deployment; the old process is not restarted automatically.'
          : 'Deploy an image revision. Traffic switches after every candidate passes readiness; the previous healthy deployment stays available until then.'}
      </p>
      <div className="flex flex-wrap gap-3 items-end">
        <Field label="Image revision" className="flex-1 min-w-0">
          <Select
            aria-label="Deployment revision"
            className="build-select mt-2"
            value={revision}
            onChange={(e) => setChosen(e.target.value)}
          >
            {!revisions.data?.length && <option value="">No built revisions</option>}
            {revisions.data?.map((r) => (
              <option key={r.id} value={r.id}>
                {new Date(r.createdAt).toLocaleString()} · {r.imageDigest.slice(0, 19)}
              </option>
            ))}
          </Select>
        </Field>
        <Button
          variant="primary"
          onClick={() => deploy.mutate()}
          disabled={
            !revision ||
            !runtime.data?.healthyNodes ||
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
        </Button>
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
              {d.status === 'releasing' ? 'Pre-deploy' : d.status}
            </span>
            <code className="text-xs ml-3">{d.id.slice(0, 8)}</code>
            <p className="text-xs text-muted mt-2">
              {new Date(d.createdAt).toLocaleString()}
              {d.errorCode && ` · ${d.errorCode.replaceAll('_', ' ')}`}
            </p>
            {d.preDeploy && <PreDeployResult job={d.preDeploy} serviceId={service.id} />}
          </div>
          {['releasing', 'waiting', 'preparing', 'active'].includes(d.status) && (
            <Button disabled={stop.isPending} onClick={() => stop.mutate(d.id)}>
              {d.status === 'waiting' ? 'Cancel replacement' : 'Stop deployment'}
            </Button>
          )}
        </div>
      ))}
      {runtime.data?.previewUrl && runtimeLabel(runtime.data) === 'Running' && (
        <a className="back-link" href={runtime.data.previewUrl} target="_blank" rel="noreferrer">
          Open application <ExternalLink size={14} />
        </a>
      )}
    </section>
  )
}

export function RuntimePanel({ service, view }: { service: Service; view: 'logs' | 'metrics' }) {
  return view === 'logs' ? <LogViewer service={service} /> : <MetricsViewer service={service} />
}
