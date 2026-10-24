import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Server, ShieldCheck } from 'lucide-react'
import { cn } from 'cn'
import { api } from './api'
import { Button, Input } from './ui'

type Node = {
  id: string
  name: string
  online: boolean
  cordoned: boolean
  draining: boolean
  lastSeen: string | null
  cpuMillis: number
  memoryMib: number
  slots: number
  reservedDiskGib: number
}
type Instance = {
  id: string
  nodeId: string
  serviceId: string
  name: string
  project: string
  environment: string
  state: string
  desiredState: string
  observedAt: string | null
  diagnostic: string | null
  cpuMillis: number | null
  memoryBytes: number | null
  requestedCpuMillis: number
  requestedMemoryMib: number
  relocationEnabled: boolean
  canEnable: boolean
  blockedReason: string | null
  relocationState: string | null
  relocationDiagnostic: string | null
}
const labels: Record<string, string> = {
  preparing: 'Starting replacement',
  draining: 'Traffic moved · draining',
  completed: 'Replacement ready · awaiting cleanup',
  failed: 'Replacement failed',
  cancelled: 'Retry requested',
}
function Capacity({
  label,
  used,
  total,
  unit,
}: {
  label: string
  used: number
  total: number
  unit: string
}) {
  return (
    <div className="min-w-0">
      <div className="mb-2 flex justify-between gap-2 text-xs">
        <span className="text-zinc-400">{label}</span>
        <span className="tabular-nums text-zinc-300">
          {used} / {total} {unit}
        </span>
      </div>
      <div className="h-1 rounded-full bg-zinc-800">
        <div
          className="h-1 rounded-full bg-orange-400"
          style={{ width: `${Math.min(100, (used / Math.max(1, total)) * 100)}%` }}
        />
      </div>
    </div>
  )
}
export function Nodes() {
  const client = useQueryClient(),
    [filter, setFilter] = useState('')
  const query = useQuery({
    queryKey: ['nodes'],
    queryFn: () => api<{ nodes: Node[]; instances: Instance[] }>('/nodes'),
    refetchInterval: 3000,
  })
  const action = useMutation({
    mutationFn: ({ id, action }: { id: string; action: string }) =>
      api(`/nodes/${id}/actions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ operationId: crypto.randomUUID(), action }),
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['nodes'] }),
  })
  const policy = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api(`/services/${id}/relocation`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ operationId: crypto.randomUUID(), enabled }),
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['nodes'] }),
  })
  const busy = action.isPending || policy.isPending
  const error = query.error || action.error || policy.error
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">INFRASTRUCTURE</p>
          <h1>Nodes</h1>
          <p className="page-description">
            Placement, capacity and safe maintenance for your workers.
          </p>
        </div>
      </div>
      <div className="mb-6 flex items-start gap-3 rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 text-xs leading-6 text-zinc-400">
        <ShieldCheck size={17} className="mt-1 shrink-0 text-orange-400" />
        <p>
          The three initial workers share Lake as one physical failure domain. Cordon pauses new
          placements. Drain moves opted-in stateless apps after their replacements are ready; pinned
          storage, jobs and singleton workers stay put.
        </p>
      </div>
      {error && (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-red-400/20 bg-red-400/5 p-4 text-sm text-red-300"
        >
          {error.message}
        </div>
      )}
      <Input
        aria-label="Filter nodes and services"
        placeholder="Filter nodes, services or projects…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        className="mb-5 max-w-md"
      />
      {query.isPending && <p className="text-sm text-zinc-400">Loading nodes…</p>}
      {query.data?.nodes.length === 0 && (
        <p className="text-sm text-zinc-400">No workers have been enrolled.</p>
      )}
      <div className="space-y-6">
        {query.data?.nodes
          .filter(
            (n) =>
              n.name.includes(filter.toLowerCase()) ||
              query.data.instances.some(
                (i) =>
                  i.nodeId === n.id &&
                  `${i.name} ${i.project}`.toLowerCase().includes(filter.toLowerCase()),
              ),
          )
          .map((node) => {
            const instances = query.data.instances.filter((i) => i.nodeId === node.id)
            const status = !node.online
              ? 'Offline'
              : node.draining
                ? instances.length
                  ? 'Draining'
                  : 'Drained'
                : node.cordoned
                  ? 'Cordoned'
                  : 'Ready'
            return (
              <section
                key={node.id}
                aria-label={node.name}
                className="overflow-hidden rounded-xl border border-zinc-800 bg-[light-dark(#fafafa,#111113)]"
              >
                <div className="flex flex-wrap items-center justify-between gap-4 border-b border-zinc-800 p-5">
                  <div className="flex items-center gap-3">
                    <Server size={20} className="text-zinc-400" />
                    <div>
                      <h2 className="text-sm font-medium">{node.name}</h2>
                      <p className="mt-1 text-[11px] text-zinc-400">
                        {node.lastSeen
                          ? `Last heartbeat ${new Date(node.lastSeen).toLocaleTimeString()}`
                          : 'Awaiting first heartbeat'}
                      </p>
                    </div>
                    <span
                      className={cn(
                        'rounded-md border px-2 py-1 text-[11px]',
                        status === 'Ready'
                          ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-400'
                          : !node.online
                            ? 'border-red-500/20 bg-red-500/10 text-red-300'
                            : 'border-amber-500/20 bg-amber-500/10 text-amber-300',
                      )}
                    >
                      {status}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {node.cordoned ? (
                      <Button
                        disabled={busy}
                        onClick={() => action.mutate({ id: node.id, action: 'uncordon' })}
                      >
                        Resume scheduling
                      </Button>
                    ) : (
                      <Button
                        disabled={busy}
                        onClick={() => action.mutate({ id: node.id, action: 'cordon' })}
                      >
                        Cordon
                      </Button>
                    )}
                    {!node.draining && (
                      <Button
                        disabled={busy}
                        onClick={() => action.mutate({ id: node.id, action: 'drain' })}
                      >
                        Drain node
                      </Button>
                    )}
                    {instances.some((i) => i.relocationState === 'failed') && (
                      <Button
                        disabled={busy}
                        onClick={() => action.mutate({ id: node.id, action: 'retry' })}
                      >
                        Retry failed moves
                      </Button>
                    )}
                  </div>
                </div>
                <div className="grid gap-5 p-5 sm:grid-cols-3">
                  <Capacity
                    label="CPU reserved"
                    used={instances.reduce((a, i) => a + i.requestedCpuMillis, 0)}
                    total={node.cpuMillis}
                    unit="m"
                  />
                  <Capacity
                    label="Memory reserved"
                    used={instances.reduce((a, i) => a + i.requestedMemoryMib, 0)}
                    total={node.memoryMib}
                    unit="MiB"
                  />
                  <Capacity
                    label="Occupied slots"
                    used={instances.length}
                    total={node.slots}
                    unit=""
                  />
                </div>
                <p className="px-5 pb-4 text-[11px] text-zinc-400">
                  Configured allocatable resources · {node.reservedDiskGib} GiB persistent storage
                  reserved. Slots stay reserved until cleanup is confirmed.
                </p>
                {instances.length === 0 ? (
                  <p className="border-t border-zinc-800 p-5 text-sm text-zinc-400">
                    No allocated instances.{' '}
                    {node.draining ? 'This node is drained and remains cordoned.' : ''}
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[700px] text-left text-xs">
                      <thead className="border-y border-zinc-800 text-[10px] uppercase tracking-wider text-zinc-400">
                        <tr>
                          <th className="px-5 py-3 font-normal">Service / instance</th>
                          <th className="px-4 py-3 font-normal">State</th>
                          <th className="px-4 py-3 font-normal">CPU / memory</th>
                          <th className="px-5 py-3 font-normal">Relocation</th>
                        </tr>
                      </thead>
                      <tbody>
                        {instances.map((i) => {
                          const fresh =
                            node.online &&
                            i.observedAt !== null &&
                            Date.now() - Date.parse(i.observedAt) < 15000
                          return (
                            <tr key={i.id} className="border-b border-zinc-800/70 last:border-0">
                              <td className="px-5 py-4">
                                <Link
                                  to="/services/$serviceId"
                                  params={{ serviceId: i.serviceId }}
                                  className="text-zinc-200 hover:text-orange-300"
                                >
                                  {i.name}
                                </Link>
                                <p className="mt-1 text-[11px] text-zinc-400">
                                  {i.project} / {i.environment} · {i.id.slice(0, 8)}
                                </p>
                              </td>
                              <td className="px-4 py-4">
                                <span
                                  className={cn(
                                    fresh && i.state === 'ready'
                                      ? 'text-emerald-400'
                                      : 'text-zinc-400',
                                  )}
                                >
                                  {i.desiredState === 'stopped'
                                    ? 'Awaiting cleanup'
                                    : fresh
                                      ? i.state
                                      : 'Unknown'}
                                </span>
                                {i.diagnostic && (
                                  <p className="mt-1 max-w-48 break-words text-[11px] text-zinc-400">
                                    {i.diagnostic.replaceAll('_', ' ')}
                                  </p>
                                )}
                              </td>
                              <td className="px-4 py-4 tabular-nums text-zinc-400">
                                {fresh
                                  ? `${i.cpuMillis?.toFixed(0) ?? '—'} m / ${i.memoryBytes === null ? '—' : (i.memoryBytes / 1048576).toFixed(0)} MiB`
                                  : '—'}
                              </td>
                              <td className="max-w-80 px-5 py-4">
                                {i.canEnable && (
                                  <label className="mb-2 flex items-center gap-2 text-zinc-300">
                                    <Input
                                      type="checkbox"
                                      checked={i.relocationEnabled}
                                      disabled={busy}
                                      aria-label={`Allow relocation for ${i.name}`}
                                      onChange={(e) =>
                                        policy.mutate({
                                          id: i.serviceId,
                                          enabled: e.target.checked,
                                        })
                                      }
                                    />
                                    Allow concurrent replacement
                                  </label>
                                )}
                                <p className="max-w-72 text-[11px] leading-5 text-zinc-400">
                                  {i.relocationState
                                    ? labels[i.relocationState]
                                    : (i.blockedReason ??
                                      (node.draining
                                        ? 'Waiting for healthy capacity on another node.'
                                        : 'Moves after node loss or an explicit drain.'))}
                                  {i.relocationDiagnostic &&
                                    ` · ${i.relocationDiagnostic.replaceAll('_', ' ')}`}
                                </p>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            )
          })}
      </div>
    </>
  )
}
