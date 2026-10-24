import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import {
  Activity,
  Clock3,
  Cable,
  ChartNoAxesCombined,
  HardDrive,
  Layers3,
  LockKeyhole,
  ScrollText,
  Settings2,
  type LucideIcon,
} from 'lucide-react'
import type { Service } from './api'
import { ContentBoundary } from './error-boundary'

interface NavigationItem {
  path: string
  label: string
  icon: LucideIcon
}
interface Detail {
  label: string
  value: ReactNode
}
export function WorkspaceLayout({
  serviceId,
  navigation,
  label,
  details,
  children,
}: {
  serviceId: string
  navigation: NavigationItem[]
  label: string
  details: Detail[]
  children: ReactNode
}) {
  return (
    <div className="grid min-w-0 gap-6 lg:grid-cols-[170px_minmax(0,1fr)]">
      <aside className="min-w-0 space-y-6">
        <nav className="flex flex-wrap gap-1 lg:flex-col" aria-label={label}>
          {navigation.map(({ path, label: title, icon: Icon }) => (
            <Link
              key={path}
              to={'/services/$serviceId/' + path}
              params={{ serviceId }}
              resetScroll={false}
              activeProps={{ 'aria-current': 'page' }}
              className="flex min-h-10 items-center gap-2.5 rounded-md px-3 py-2 text-xs text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-100 aria-[current=page]:bg-orange-400/10 aria-[current=page]:text-orange-300"
            >
              <Icon size={15} />
              {title}
            </Link>
          ))}
        </nav>
        <dl className="grid grid-cols-2 gap-4 border-t border-zinc-800 pt-5 text-xs sm:grid-cols-4 lg:grid-cols-1">
          {details.map(({ label, value }) => (
            <div key={label}>
              <dt className="text-muted">{label}</dt>
              <dd className="mt-1.5">{value}</dd>
            </div>
          ))}
        </dl>
      </aside>
      <div className="min-w-0">
        <ContentBoundary scope="tab">{children}</ContentBoundary>
      </div>
    </div>
  )
}
export function ServiceWorkspace({ service, children }: { service: Service; children: ReactNode }) {
  const { spec } = service
  const fleet = spec.workload.kind === 'celld-service'
  return (
    <WorkspaceLayout
      serviceId={service.id}
      label="Service navigation"
      navigation={[
        { path: 'builds', label: fleet ? 'Fleet deployments' : 'Builds', icon: Layers3 },
        ...(spec.workload.kind === 'oci-service'
          ? [{ path: 'jobs', label: 'Jobs', icon: Clock3 }]
          : []),
        { path: 'logs', label: 'Logs', icon: ScrollText },
        { path: 'metrics', label: 'Metrics', icon: ChartNoAxesCombined },
        { path: 'activity', label: 'Activity', icon: Activity },
        { path: 'configuration', label: 'Configuration', icon: Settings2 },
        { path: 'networking', label: 'Networking', icon: Cable },
        { path: 'storage', label: 'Storage', icon: HardDrive },
        { path: 'secrets', label: 'Secrets', icon: LockKeyhole },
      ]}
      details={[
        {
          label: fleet ? 'Requested members' : 'Requested replicas',
          value:
            spec.workload.kind === 'oci-service'
              ? spec.workload.replicas
              : spec.workload.kind === 'celld-service'
                ? spec.workload.members
                : 1,
        },
        {
          label: 'Placement',
          value: spec.distinct_nodes
            ? 'Distinct nodes'
            : spec.volume || spec.workload.kind === 'rustfs-service'
              ? 'Volume owner'
              : 'Any eligible node',
        },
        { label: 'CPU per instance', value: `${spec.resources.cpu_millis}m` },
        { label: 'Memory per instance', value: `${spec.resources.memory_mib} MiB` },
      ]}
    >
      {children}
    </WorkspaceLayout>
  )
}
