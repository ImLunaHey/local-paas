import type { HostsData } from './overview-types'

import type { UseQueryResult } from '@tanstack/react-query'
import { Status } from '../../components/status'

export function WorkerCapacity({ query }: { query: UseQueryResult<HostsData, Error> }) {
  return (
    <section className="panel mt-7 overflow-hidden">
      <div className="border-b border-zinc-800 p-5">
        <h2>Worker capacity</h2>
        <p className="mt-2 text-xs text-muted">
          Scheduling reservations, not measured VM usage. Workers on the same host share one
          physical failure domain.
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
  )
}
