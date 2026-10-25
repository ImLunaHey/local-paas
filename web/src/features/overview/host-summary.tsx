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
        <div
          className="metric [padding:18px_20px] [border:1px_solid_light-dark(#e4e4e7,_#28282c)] [border-radius:7px] [background:linear-gradient(145deg,_light-dark(#f4f4f5,_#19191b),_light-dark(#f4f4f5,_#121213))] [&_strong]:[display:block] [&_strong]:[font-size:23px] [&_strong]:[font-weight:450] [&_strong]:[letter-spacing:-0.6px] [&_strong]:[margin:15px_0_7px] [&_p]:[font-size:10px] [&_p]:[color:light-dark(#52525b,_#8d8d95)] [&_p]:[line-height:1.6] max-[720px]:[padding:17px] max-[720px]:[&_strong]:[margin:12px_0_6px] max-[720px]:[&_strong]:[font-size:22px]"
          key={label}
        >
          <div className="text-xs text-muted">{label}</div>
          <strong>{value}</strong>
          <p>{detail}</p>
        </div>
      ))}
    </div>
  )
}
