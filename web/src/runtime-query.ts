import { useQuery } from '@tanstack/react-query'
import { api } from './api-client'
import type { ReleaseJob } from './release-job'

export interface Instance {
  id: string
  deploymentId: string
  nodeId: string
  nodeName: string
  state: string
  agentReachability: 'reachable' | 'stale' | 'unreachable'
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
  edgePhase?: string | null
  preDeploy?: ReleaseJob | null
  id: string
  revisionId: string
  status: string
  runtimeHealth: 'healthy' | 'recovering' | 'degraded'
  runtimeHealthReason: string | null
  errorCode: string | null
  createdAt: string
}
export interface HealthEvent {
  sequence: number
  instanceId: string
  nodeName: string
  observedAt: string
  process: string
  startup: string
  readiness: string
  liveness: string
  recovery: string
  restartAttempts: number
  retryAt: string | null
  diagnostic: string | null
}
export interface RuntimeStatus {
  deployments: Deployment[]
  instances: Instance[]
  healthHistory: HealthEvent[]
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
