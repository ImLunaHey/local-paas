import { gib } from './host-format'
import type { HostSample } from './overview-types'

export function HostSummary({
  fresh: isFresh,
  latest,
}: {
  fresh: boolean | undefined
  latest: HostSample | undefined
}) {
  const fresh = latest && isFresh
  return (
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
  )
}
