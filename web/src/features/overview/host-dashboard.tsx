import { Status } from '../../components/status'
import { WorkerCapacity } from './worker-capacity'
import { HostSummary } from './host-summary'
import type { HostSample, HostsData } from './overview-types'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { api } from '../../api-client'
import { Trend } from '../../trend'
import { Select } from '../../components/select'

export function Hosts() {
  const [range, setRange] = useState('15m')
  const query = useQuery({
    queryKey: ['hosts', range],
    queryFn: () => api<HostsData>(`/hosts?range=${range}`),
    refetchInterval: 5000,
  })
  const samples = query.data?.host.samples ?? []
  const latest = samples.at(-1)
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
      <HostSummary fresh={fresh} latest={latest} />
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
      <WorkerCapacity query={query} />
    </>
  )
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
