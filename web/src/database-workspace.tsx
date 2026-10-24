import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import {
  Activity,
  Cable,
  ChartNoAxesCombined,
  Circle,
  Database,
  Layers3,
  ScrollText,
  Settings2,
} from 'lucide-react'
import { cn } from 'cn'
import { api } from './api-client'
import type { Service } from './generated/model/service'
import type { DatabaseState } from './databases'
import { ProjectBackLink } from './projects'
import { Button } from './components/button'
import { WorkspaceLayout } from './service-workspace'

const navigation = [
  { path: 'overview', label: 'Overview', icon: Database },
  { path: 'networking', label: 'Connections', icon: Cable },
  { path: 'metrics', label: 'Metrics', icon: ChartNoAxesCombined },
  { path: 'logs', label: 'Logs', icon: ScrollText },
  { path: 'builds', label: 'Deployments', icon: Layers3 },
  { path: 'activity', label: 'Activity', icon: Activity },
  { path: 'configuration', label: 'Settings', icon: Settings2 },
]
export function DatabaseWorkspace({
  service,
  status,
  children,
}: {
  service: Service
  status: string
  children: ReactNode
}) {
  const { spec } = service
  const navigate = useNavigate()
  const engine = spec.workload.kind === 'redis-service' ? 'Redis' : 'PostgreSQL'
  const info = useQuery({
    queryKey: ['database', service.id],
    queryFn: () => api<DatabaseState>('/services/' + service.id + '/database'),
    refetchInterval: 15000,
  })
  return (
    <>
      <ProjectBackLink project={spec.project} environment={spec.environment} />
      <header className="mb-8 flex flex-wrap items-center justify-between gap-5 border-b border-zinc-800 pb-6">
        <div className="flex min-w-0 items-center gap-4">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-xl border border-orange-400/20 bg-orange-400/10 text-orange-300">
            <Database size={25} />
          </div>
          <div className="min-w-0">
            <p className="mb-2 text-xs text-muted">{engine} · private database</p>
            <h1 className="break-words text-2xl font-semibold">{spec.name}</h1>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span
            className={cn(
              'inline-flex items-center gap-2 rounded-md border border-zinc-700 px-3 py-2 text-xs text-zinc-400',
              status === 'Running' && 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300',
            )}
          >
            <Circle size={9} />
            {status}
          </span>
          <Button
            onClick={() =>
              void navigate({
                to: '/services/$serviceId/networking',
                params: { serviceId: service.id },
              })
            }
          >
            Connect an application
          </Button>
        </div>
      </header>
      <WorkspaceLayout
        serviceId={service.id}
        navigation={navigation}
        label="Database navigation"
        details={[
          {
            label: 'Worker',
            value: info.error
              ? 'Unavailable'
              : info.isPending
                ? 'Loading…'
                : (info.data?.volume?.node ?? 'Not allocated'),
          },
          {
            label: 'Persistent volume',
            value: info.data?.volume ? info.data.volume.sizeGib + ' GiB' : '—',
          },
          { label: 'CPU limit', value: spec.resources.cpuMillis + 'm' },
          { label: 'Memory limit', value: spec.resources.memoryMib + ' MiB' },
        ]}
      >
        {children}
      </WorkspaceLayout>
    </>
  )
}
