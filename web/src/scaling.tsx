import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './api-client'
import type { Service } from './generated/model/service'
import type { ScalingPolicy } from './generated/model/scalingPolicy'
import { Button } from './components/button'
import { Field } from './components/field'
import { Input } from './components/input'
import { Select } from './components/select'
import { WakingPageSettings } from './waking-page'

interface ScalingStatus {
  eligible: boolean
  currentReplicas: number
  state: {
    version: number
    policy: ScalingPolicy
    desiredReplicas: number
    condition: string
    evaluatedAt?: string
  }
  limits: { enabled: boolean; maxInstances: number; maxCpuMillis: number; maxMemoryMib: number }
  decisions: {
    id: string
    timestamp: string
    currentReplicas: number
    recommendedReplicas: number
    desiredReplicas: number
    cpuPercent: number | null
    reason: string
    estimatedCapacity: number | null
  }[]
}
const numericFields = [
  ['minReplicas', 'Minimum replicas', 0, 32],
  ['maxReplicas', 'Maximum replicas', 1, 32],
  ['targetCpuPercent', 'CPU target (%)', 10, 90],
  ['maxStep', 'Maximum change per decision', 1, 4],
  ['scaleUpWindowSeconds', 'Scale-out stabilization (seconds)', 15, 3600],
  ['scaleDownWindowSeconds', 'Scale-in stabilization (seconds)', 60, 3600],
  ['cooldownSeconds', 'Cooldown (seconds)', 30, 3600],
  ['idleSeconds', 'Idle time before sleeping (seconds)', 300, 86400],
] as const

function ScalingForm({ serviceId, state }: { serviceId: string; state: ScalingStatus['state'] }) {
  const client = useQueryClient()
  const save = useMutation({
    mutationFn: (policy: ScalingPolicy) =>
      api<ScalingStatus>(`/services/${serviceId}/scaling`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          operationId: crypto.randomUUID(),
          expectedVersion: state.version,
          policy,
        }),
      }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['scaling', serviceId] })
    },
  })
  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault()
        const data = new FormData(event.currentTarget)
        const policy = { ...state.policy }
        for (const [name] of numericFields) policy[name] = Number(data.get(name))
        policy.enabled = data.get('enabled') === 'true'
        policy.preferFailureDomainSpread = data.get('preferFailureDomainSpread') === 'true'
        policy.nodeNames = String(data.get('nodeNames'))
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
        policy.failureDomains = String(data.get('failureDomains'))
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
        save.mutate(policy)
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Automatic scaling">
          <Select name="enabled" defaultValue={String(state.policy.enabled)}>
            <option value="false">Disabled</option>
            <option value="true">Enabled — replicas are stateless and safe to stop</option>
          </Select>
        </Field>
        <Field label="Physical failure-domain preference">
          <Select
            name="preferFailureDomainSpread"
            defaultValue={String(state.policy.preferFailureDomainSpread)}
          >
            <option value="true">Prefer less occupied physical domains</option>
            <option value="false">No preference</option>
          </Select>
        </Field>
        {numericFields.map(([name, label, min, max]) => (
          <Field key={name} label={label}>
            <Input
              name={name}
              type="number"
              min={min}
              max={max}
              step={1}
              defaultValue={state.policy[name]}
              required
            />
          </Field>
        ))}
        <Field
          label="Allowed node names"
          hint="Comma-separated enrollment labels. Empty allows any eligible node."
        >
          <Input name="nodeNames" defaultValue={state.policy.nodeNames?.join(', ')} />
        </Field>
        <Field
          label="Allowed physical failure domains"
          hint="Comma-separated enrollment labels. Co-located VMs share a domain."
        >
          <Input name="failureDomains" defaultValue={state.policy.failureDomains?.join(', ')} />
        </Field>
      </div>
      <p className="text-xs leading-relaxed text-zinc-400">
        A minimum of zero enables sleep after sustained CPU at or below 1% and no ingress requests
        or open streams. The first request wakes the service. Browser visitors see a “Waking up
        service” page and automatically continue when the app is ready. API calls and form
        submissions receive 503 with Retry-After: 5 and must retry safely. Requests are never queued
        or replayed; private connection targets cannot sleep.
      </p>
      <p className="text-xs leading-relaxed text-zinc-400">
        Scaling pauses during deployments, jobs, cleanup, missing measurements, or capacity
        shortages. CPU is sampled with a delay; low CPU alone does not prove an application is safe
        to interrupt. Disabling freezes the current count. Deploy again to restore the configured
        fixed replicas.
      </p>
      {save.error && (
        <p role="alert" className="error-notice">
          {save.error.message}
        </p>
      )}
      <Button type="submit" variant="primary" disabled={save.isPending}>
        {save.isPending ? 'Saving…' : 'Save scaling policy'}
      </Button>
    </form>
  )
}

export function ScalingPanel({ service }: { service: Service }) {
  const query = useQuery({
    queryKey: ['scaling', service.id],
    queryFn: ({ signal }) => api<ScalingStatus>(`/services/${service.id}/scaling`, { signal }),
    refetchInterval: 5000,
  })
  const data = query.data
  return (
    <section
      className="mt-6 min-w-0 space-y-5 rounded-lg border border-zinc-800 p-4 sm:p-6"
      aria-label="Autoscaling"
    >
      <h2 className="text-base font-medium">Autoscaling</h2>
      {query.error && (
        <p role="alert" className="error-notice">
          {query.error.message}
        </p>
      )}
      {!data && !query.error && <p className="text-sm text-zinc-400">Loading scaling policy…</p>}
      {data && (
        <>
          <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs text-zinc-400">Ready replicas</dt>
              <dd>{data.currentReplicas}</dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-400">Desired replicas</dt>
              <dd>{data.state.desiredReplicas}</dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-400">Condition</dt>
              <dd className="break-words">{data.state.condition.replaceAll('_', ' ')}</dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-400">Additional capacity at last evaluation</dt>
              <dd>{data.decisions[0]?.estimatedCapacity ?? 'Not evaluated'}</dd>
            </div>
          </dl>
          <p className="text-xs text-zinc-400">
            Operator budget: {data.limits.maxInstances} occupied instances,{' '}
            {data.limits.maxCpuMillis}m CPU, {data.limits.maxMemoryMib} MiB memory. Automatic
            scaling is {data.limits.enabled ? 'available' : 'paused globally'}. Estimates use
            reserved worker capacity and do not imply physical elasticity.
          </p>
          {data.eligible ? (
            <>
              <ScalingForm
                key={`${service.id}:${data.state.version}`}
                serviceId={service.id}
                state={data.state}
              />
              <WakingPageSettings serviceId={service.id} serviceName={service.spec.name} />
            </>
          ) : (
            <p className="text-sm text-zinc-400">
              Only stateless HTTP OCI services without volumes or pre-deploy commands can autoscale.
            </p>
          )}
          {data.decisions.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-medium">Recent decisions</h3>
              <ul className="space-y-2 text-xs text-zinc-400">
                {data.decisions.slice(0, 8).map((decision) => (
                  <li
                    key={decision.id}
                    className="flex flex-wrap gap-x-3 gap-y-1 border-t border-zinc-800 pt-2"
                  >
                    <time dateTime={decision.timestamp}>
                      {new Date(decision.timestamp).toLocaleString()}
                    </time>
                    <span>{decision.reason.replaceAll('_', ' ')}</span>
                    <span>
                      {decision.currentReplicas} current → {decision.recommendedReplicas}{' '}
                      recommended → {decision.desiredReplicas} desired
                    </span>
                    <span>
                      CPU{' '}
                      {decision.cpuPercent === null
                        ? 'unavailable'
                        : `${decision.cpuPercent.toFixed(1)}%`}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  )
}
