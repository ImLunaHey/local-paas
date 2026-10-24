import { RecentList } from './recent-list'

import type { OverviewData } from './overview-types'
import { useQuery } from '@tanstack/react-query'

import { Link } from '@tanstack/react-router'
import { Activity, ArrowUpRight, Layers3, Server, GitBranch } from 'lucide-react'

import { api } from '../../api-client'

export function Overview() {
  const query = useQuery({
    queryKey: ['overview'],
    queryFn: () => api<OverviewData>('/overview'),
    refetchInterval: 5000,
  })
  const s = query.data?.summary
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
        {[
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
          [
            'Workers online',
            s ? `${s.healthyNodes} / ${s.totalNodes}` : undefined,
            'One physical failure domain',
            <Server key="Server" size={17} />,
          ],
          [
            'Builds in progress',
            s?.pendingBuilds,
            `${s?.failedDeployments ?? '—'} failed deployments in 24h`,
            <GitBranch key="GitBranch" size={17} />,
          ],
        ].map(([label, value, detail, icon]) => (
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
      <Link to="/hosts" className="panel mt-6 flex items-center gap-4 p-5 hover:border-zinc-600">
        <Server size={20} className="text-accent" />
        <div className="flex-1">
          <h2>Infrastructure</h2>
          <p className="mt-1 text-xs text-muted">
            Controller host resource usage and worker capacity.
          </p>
        </div>
        <ArrowUpRight size={17} />
      </Link>
    </>
  )
}
