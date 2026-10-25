import { RecentList } from './recent-list'

import type { OverviewData } from './overview-types'
import { useQuery } from '@tanstack/react-query'

import { Link } from '@tanstack/react-router'
import { Activity, ArrowUpRight, Layers3, Server, GitBranch } from 'lucide-react'

import { api } from '../../api-client'
import { authClient } from '../../auth-client'

export function Overview() {
  const activeOrganization = authClient.useActiveOrganization()
  const query = useQuery({
    queryKey: ['overview', activeOrganization.data?.id],
    queryFn: () => api<OverviewData>('/overview'),
    refetchInterval: 5000,
  })
  const s = query.data?.summary
  const hasOrganizationNodes = (s?.totalNodes ?? 0) > 0
  const metrics = [
    [
      'Projects',
      s?.projects,
      `${s?.services ?? '—'} services`,
      <Layers3 key="Layers3" size={17} />,
    ],
    [
      'Healthy instances',
      s?.readyInstances,
      'Fresh readiness reports',
      <Activity key="Activity" size={17} />,
    ],
    ...(hasOrganizationNodes
      ? [
          [
            'Owned nodes',
            `${s?.healthyNodes} / ${s?.totalNodes}`,
            'Organization-owned hardware',
            <Server key="Server" size={17} />,
          ],
        ]
      : []),
    [
      'Builds in progress',
      s?.pendingBuilds,
      `${s?.failedDeployments ?? '—'} failed deployments in 24h`,
      <GitBranch key="GitBranch" size={17} />,
    ],
  ]
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">YOUR PLATFORM</div>
          <h1>Overview</h1>
          <p>A live view of what’s shipping and what’s running.</p>
        </div>
        <Link to="/projects" className="button secondary">
          <Layers3 size={15} />
          View projects
        </Link>
      </div>
      {query.error && (
        <p role="alert" className="error-notice">
          Could not refresh overview. {query.error.message}
        </p>
      )}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 mb-7">
        {metrics.map(([label, value, detail, icon]) => (
          <div className="metric" key={String(label)}>
            <div className="flex justify-between text-xs text-muted">
              {label}
              {icon}
            </div>
            <strong>{value ?? '—'}</strong>
            <p>{detail}</p>
          </div>
        ))}
      </div>
      <div className="grid gap-6 xl:grid-cols-[1.3fr_1fr]">
        <RecentList items={query.data?.deployments ?? []} />
        <RecentList builds items={query.data?.builds ?? []} />
      </div>
      {hasOrganizationNodes && (
        <Link to="/nodes" className="panel mt-6 flex items-center gap-4 p-5 hover:border-zinc-600">
          <Server size={20} className="text-accent" />
          <div className="flex-1">
            <h2>Organization hardware</h2>
            <p className="mt-1 text-xs text-muted">
              Capacity and maintenance for nodes owned by this organization.
            </p>
          </div>
          <ArrowUpRight size={17} />
        </Link>
      )}
    </>
  )
}
