import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Activity, ArrowUpRight, Box, Layers3, Server, GitBranch } from 'lucide-react'
import { cn } from 'cn'
import { api } from './api'
import { Trend } from './trend'
import { Select } from './ui'
interface Recent {
  id: string
  serviceId: string
  service: string
  project: string
  environment: string
  status: string
  createdAt: string
  errorCode: string | null
}
interface OverviewData {
  summary: {
    projects: number
    services: number
    readyInstances: number
    healthyNodes: number
    totalNodes: number
    pendingBuilds: number
    failedDeployments: number
  }
  deployments: Recent[]
  builds: Recent[]
}
export function Status({ value }: { value: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded border px-2 py-1 text-[10px] capitalize',
        ['active', 'succeeded', 'Running', 'Healthy'].includes(value)
          ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300'
          : ['failed', 'Unavailable', 'Offline'].includes(value)
            ? 'border-red-400/20 bg-red-400/10 text-red-300'
            : ['preparing', 'queued', 'running'].includes(value)
              ? 'border-orange-400/20 bg-orange-400/10 text-orange-300'
              : 'border-zinc-700 bg-zinc-800/40 text-zinc-400',
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {value === 'active' ? 'Running' : value}
    </span>
  )
}
function RecentList({ items, builds = false }: { items: Recent[]; builds?: boolean }) {
  return (
    <section className="panel overflow-hidden">
      <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
        <h2>{builds ? 'Recent builds' : 'Latest deployments'}</h2>
        <span className="text-xs text-muted">
          {builds ? 'Source → image' : 'Image → application'}
        </span>
      </div>
      {items.length === 0 && (
        <div className="p-10 text-center text-sm text-muted">
          {builds
            ? 'Your first build will appear here.'
            : 'Deploy a revision to see its progress here.'}
        </div>
      )}
      {items.map((item) => (
        <Link
          key={item.id}
          to={builds ? '/services/$serviceId/builds' : '/services/$serviceId/activity'}
          params={{ serviceId: item.serviceId }}
          className="flex items-center gap-3 border-b border-zinc-800/70 px-5 py-4 last:border-0 hover:bg-zinc-800/30"
        >
          <span className="hidden sm:grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-zinc-800 text-muted">
            {builds ? <GitBranch size={16} /> : <Box size={16} />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm">{item.service}</div>
            <div className="mt-1 truncate text-xs text-muted">
              {item.project} / {item.environment}
            </div>
            {item.errorCode && (
              <div className="mt-1 truncate text-xs text-red-300">
                {item.errorCode.replaceAll('_', ' ')}
              </div>
            )}
          </div>
          <div className="shrink-0 text-right">
            <Status value={item.status} />
            <time dateTime={item.createdAt} className="mt-2 block text-[10px] text-muted">
              {new Date(item.createdAt).toLocaleString([], {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </time>
          </div>
          <ArrowUpRight size={14} className="hidden sm:block text-muted" />
        </Link>
      ))}
    </section>
  )
}
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
          <p className="mt-1 text-xs text-muted">Lake’s live resource usage and worker capacity.</p>
        </div>
        <ArrowUpRight size={17} />
      </Link>
    </>
  )
}
interface HostSample {
  timestamp: string
  cpuPercent: number | null
  memoryUsedBytes: number | null
  memoryTotalBytes: number | null
  swapUsedBytes: number | null
  loadOne: number | null
  uptimeSeconds: number | null
  rootTotalBytes: number | null
  rootAvailableBytes: number | null
  networkRxBytesPerSecond: number | null
  networkTxBytesPerSecond: number | null
  diskReadBytesPerSecond: number | null
  diskWriteBytesPerSecond: number | null
}
interface Node {
  id: string
  name: string
  healthy: boolean
  cordoned: boolean
  lastSeen: string | null
  cpuMillis: number
  memoryMib: number
  slots: number
  occupiedSlots: number
  reservedCpuMillis: number
  reservedMemoryMib: number
}
interface HostsData {
  host: {
    name: string | null
    samples: HostSample[]
    bucketSeconds: number
    retentionDays: number
  }
  nodes: Node[]
}
const fields: {
  field: keyof Omit<HostSample, 'timestamp'>
  label: string
  unit: string
  scale: number
}[] = [
  { field: 'cpuPercent', label: 'Host CPU', unit: '%', scale: 1 },
  { field: 'memoryUsedBytes', label: 'Memory used', unit: 'GiB', scale: 2 ** 30 },
  { field: 'diskReadBytesPerSecond', label: 'Disk read', unit: 'MiB/s', scale: 2 ** 20 },
  { field: 'diskWriteBytesPerSecond', label: 'Disk write', unit: 'MiB/s', scale: 2 ** 20 },
  {
    field: 'networkRxBytesPerSecond',
    label: 'Network received',
    unit: 'MiB/s',
    scale: 2 ** 20,
  },
  { field: 'networkTxBytesPerSecond', label: 'Network sent', unit: 'MiB/s', scale: 2 ** 20 },
]
const gib = (n: number | null | undefined) => (n == null ? '—' : (n / 2 ** 30).toFixed(1) + ' GiB')
export function Hosts() {
  const [range, setRange] = useState('15m')
  const query = useQuery({
    queryKey: ['hosts', range],
    queryFn: () => api<HostsData>(`/hosts?range=${range}`),
    refetchInterval: 5000,
  })
  const samples = query.data?.host.samples ?? [],
    latest = samples.at(-1)
  const fresh = latest && Date.now() - Date.parse(latest.timestamp) < 20000 && !query.isError
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">INFRASTRUCTURE</div>
          <h1>
            {query.data?.host.name ?? 'Host'} <span className="text-muted">/ resources</span>
          </h1>
          <p>Controller host measurements · updates every 5 seconds</p>
        </div>
        <div className="flex items-center gap-3">
          <Select
            aria-label="Host history range"
            value={range}
            onChange={(event) => setRange(event.target.value)}
          >
            <option value="15m">Last 15 minutes</option>
            <option value="1h">Last hour</option>
            <option value="24h">Last 24 hours</option>
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
          </Select>
          <Status value={fresh ? 'Healthy' : query.isPending ? 'Connecting' : 'Unavailable'} />
        </div>
      </div>
      {query.error && (
        <p role="alert" className="error-notice">
          Could not refresh host statistics. {query.error.message}
        </p>
      )}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 mb-6">
        {[
          [
            'Physical memory',
            gib(fresh ? latest.memoryTotalBytes : null),
            'Used = total − available',
          ],
          [
            'Root filesystem free',
            gib(fresh ? latest.rootAvailableBytes : null),
            `${gib(latest?.rootTotalBytes)} total · excludes ZFS`,
          ],
          ['Swap used', gib(fresh ? latest.swapUsedBytes : null), 'Host-wide usage'],
          [
            'Uptime',
            fresh && latest.uptimeSeconds != null
              ? (latest.uptimeSeconds / 86400).toFixed(1) + ' days'
              : '—',
            `1-minute load: ${fresh ? (latest.loadOne?.toFixed(2) ?? '—') : '—'}`,
          ],
        ].map(([label, value, detail]) => (
          <div className="metric" key={label}>
            <div className="text-xs text-muted">{label}</div>
            <strong>{value}</strong>
            <p>{detail}</p>
          </div>
        ))}
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {fields.map(({ field, label, unit, scale }) => (
          <section key={field} className="panel min-w-0 p-5">
            <div className="mb-4 flex justify-between gap-3">
              <h2>{label}</h2>
              <span className="text-xs text-muted">
                {fresh && latest[field] != null
                  ? (latest[field]! / scale).toFixed(1) + ' ' + unit
                  : '—'}
              </span>
            </div>
            {samples.filter((s) => s[field] != null).length > 1 ? (
              <Trend
                label={label}
                unit={unit}
                gapMs={Math.max(20000, (query.data?.host.bucketSeconds ?? 5) * 2000)}
                showDate={['24h', '7d', '30d'].includes(range)}
                points={samples.map((s) => ({
                  time: Date.parse(s.timestamp),
                  value: s[field] == null ? null : s[field]! / scale,
                }))}
              />
            ) : (
              <p className="py-14 text-center text-xs text-muted">
                Collecting history for this range
              </p>
            )}
          </section>
        ))}
      </div>
      <p className="my-4 text-xs leading-relaxed text-muted">
        History is saved in PostgreSQL for 30 days and survives API and host restarts. Longer ranges
        show the latest measurement per time bucket. Collection pauses leave gaps. These are
        whole-host measurements, including other applications and VMs. Disk rates sum physical block
        devices; network rates sum non-loopback interfaces and may count tunnel traffic twice. ZFS
        health and ARC are not measured here.
      </p>
      <section className="panel mt-7 overflow-hidden">
        <div className="border-b border-zinc-800 p-5">
          <h2>Worker capacity</h2>
          <p className="mt-2 text-xs text-muted">
            Scheduling reservations, not measured VM usage. All three development workers share
            Lake’s physical failure domain.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[650px] text-left text-xs">
            <thead className="border-b border-zinc-800 text-[10px] uppercase tracking-wider text-muted">
              <tr>
                {['Worker', 'Status', 'CPU reserved', 'Memory reserved', 'Slots'].map((h) => (
                  <th key={h} className="p-4 font-normal">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {query.data?.nodes.map((n) => (
                <tr key={n.id} className="border-b border-zinc-800/70 last:border-0">
                  <td className="p-4">
                    {n.name}
                    <span className="mt-1 block text-[10px] text-muted">
                      {n.lastSeen
                        ? 'Seen ' + new Date(n.lastSeen).toLocaleTimeString()
                        : 'Never connected'}
                    </span>
                  </td>
                  <td className="p-4">
                    <Status value={!n.healthy ? 'Offline' : n.cordoned ? 'Cordoned' : 'Healthy'} />
                  </td>
                  <td className="p-4">
                    {n.reservedCpuMillis} / {n.cpuMillis} m
                  </td>
                  <td className="p-4">
                    {n.reservedMemoryMib} / {n.memoryMib} MiB
                  </td>
                  <td className="p-4">
                    {n.occupiedSlots} / {n.slots}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {query.data?.nodes.length === 0 && (
          <p className="p-6 text-xs text-muted">No workers enrolled yet.</p>
        )}
      </section>
    </>
  )
}
