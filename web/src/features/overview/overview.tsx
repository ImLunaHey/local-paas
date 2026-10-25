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
      <div className="page-heading [display:flex] [justify-content:space-between] [align-items:center] [gap:24px] [margin-bottom:30px] [&_p]:[color:light-dark(#52525b,_#a0a0a8)] [&_p]:[font-size:12px] [&_p]:[margin-top:12px] max-[720px]:[align-items:start] max-[720px]:[flex-direction:column] max-[720px]:[gap:20px]">
        <div>
          <div className="eyebrow [font-size:9px] [letter-spacing:1.7px] [color:light-dark(#52525b,_#8d8d95)] [font-weight:600] [text-transform:uppercase] [margin-bottom:13px]">
            YOUR PLATFORM
          </div>
          <h1>Overview</h1>
          <p>A live view of what’s shipping and what’s running.</p>
        </div>
        <Link
          to="/projects"
          className="button secondary [display:inline-flex] [align-items:center] [justify-content:center] [gap:8px] [font-size:11px] [font-weight:600] [line-height:1] [white-space:nowrap] [border:1px_solid_transparent] [border-radius:6px] [padding:12px_15px] [&.primary]:[background:#ff8a4c] [&.primary]:[color:#1b100a] [&.primary]:[border-color:#ff8a4c] [&.primary:hover]:[background:#ffa36c] [&.secondary]:[background:light-dark(#e4e4e7,_#1b1b1e)] [&.secondary]:[border-color:light-dark(#d4d4d8,_#38383c)] [&.secondary]:[color:light-dark(#27272a,_#e7e7eb)] [&.secondary:hover]:[background:light-dark(#e4e4e7,_#1b1b1e)]"
        >
          <Layers3 size={15} />
          View projects
        </Link>
      </div>
      {query.error && (
        <p
          role="alert"
          className="error-notice [border:1px_solid_#4d2b2d] [background:light-dark(#f4f4f5,_#231719)] [border-radius:7px] [padding:18px] [font-size:12px] [color:#ffb4ae] [line-height:1.8] [overflow-wrap:anywhere] [&_p]:[margin-top:5px]"
        >
          Could not refresh overview. {query.error.message}
        </p>
      )}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 mb-7">
        {metrics.map(([label, value, detail, icon]) => (
          <div
            className="metric [padding:18px_20px] [border:1px_solid_light-dark(#e4e4e7,_#28282c)] [border-radius:7px] [background:linear-gradient(145deg,_light-dark(#f4f4f5,_#19191b),_light-dark(#f4f4f5,_#121213))] [&_strong]:[display:block] [&_strong]:[font-size:23px] [&_strong]:[font-weight:450] [&_strong]:[letter-spacing:-0.6px] [&_strong]:[margin:15px_0_7px] [&_p]:[font-size:10px] [&_p]:[color:light-dark(#52525b,_#8d8d95)] [&_p]:[line-height:1.6] max-[720px]:[padding:17px] max-[720px]:[&_strong]:[margin:12px_0_6px] max-[720px]:[&_strong]:[font-size:22px]"
            key={String(label)}
          >
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
        <Link
          to="/nodes"
          className="panel mt-6 flex items-center gap-4 p-5 hover:border-zinc-600 [background:light-dark(#f4f4f5,_#131315)] [border:1px_solid_light-dark(#e4e4e7,_#28282c)] [border-radius:8px] [box-shadow:0_1px_0_#ffffff04_inset,_0_8px_24px_#0000000d]"
        >
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
