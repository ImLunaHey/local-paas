import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
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
import { api, type Service } from './api'
import type { DatabaseState } from './databases'
import { ProjectBackLink } from './projects'
import { Button } from './ui'

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
      <div className="grid min-w-0 gap-6 lg:grid-cols-[170px_minmax(0,1fr)]">
        <aside className="min-w-0 space-y-6">
          <nav className="flex flex-wrap gap-1 lg:flex-col" aria-label="Database navigation">
            {navigation.map(({ path, label, icon: Icon }) => (
              <Link
                key={path}
                to={'/services/$serviceId/' + path}
                params={{ serviceId: service.id }}
                resetScroll={false}
                activeProps={{ 'aria-current': 'page' }}
                className="flex min-h-10 items-center gap-2.5 rounded-md px-3 py-2 text-xs text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-100 aria-[current=page]:bg-orange-400/10 aria-[current=page]:text-orange-300"
              >
                <Icon size={15} />
                {label}
              </Link>
            ))}
          </nav>
          <dl className="grid grid-cols-2 gap-4 border-t border-zinc-800 pt-5 text-xs sm:grid-cols-4 lg:grid-cols-1">
            <div>
              <dt className="text-muted">Worker</dt>
              <dd className="mt-1.5">
                {info.error
                  ? 'Unavailable'
                  : info.isPending
                    ? 'Loading…'
                    : (info.data?.volume?.node ?? 'Not allocated')}
              </dd>
            </div>
            <div>
              <dt className="text-muted">Persistent volume</dt>
              <dd className="mt-1.5">
                {info.data?.volume ? `${info.data.volume.size_gib} GiB` : '—'}
              </dd>
            </div>
            <div>
              <dt className="text-muted">CPU limit</dt>
              <dd className="mt-1.5">{spec.resources.cpu_millis}m</dd>
            </div>
            <div>
              <dt className="text-muted">Memory limit</dt>
              <dd className="mt-1.5">{spec.resources.memory_mib} MiB</dd>
            </div>
          </dl>
        </aside>
        <section className="min-w-0" aria-label="Database content">
          {children}
        </section>
      </div>
    </>
  )
}
