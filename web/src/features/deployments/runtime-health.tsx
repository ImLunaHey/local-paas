import type { RuntimeStatus } from '../../runtime-query'

export function RuntimeHealth({ runtime }: { runtime: RuntimeStatus }) {
  const active = runtime.deployments.find((deployment) => deployment.status === 'active')
  if (!active) return null
  const instances = runtime.instances.filter(
    (instance) => instance.deploymentId === active.id && instance.desiredState === 'running',
  )
  return (
    <section
      className="rounded-md border border-zinc-800 p-4 space-y-3"
      aria-label="Runtime health"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm">Runtime health</h3>
        <span
          className="chip"
          data-state={active.runtimeHealth === 'healthy' ? 'succeeded' : 'failed'}
        >
          {active.runtimeHealth}
        </span>
      </div>
      {active.runtimeHealthReason && (
        <p className="text-xs text-muted">{active.runtimeHealthReason.replaceAll('_', ' ')}</p>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        {instances.map((instance) => (
          <div className="rounded border border-zinc-800 p-3 text-xs" key={instance.id}>
            <div className="flex items-center justify-between gap-2">
              <code>{instance.id.slice(0, 8)}</code>
              <span
                className="chip"
                data-state={instance.state === 'ready' ? 'succeeded' : 'failed'}
              >
                {instance.state}
              </span>
            </div>
            <p className="text-muted mt-2">
              {instance.nodeName} · agent {instance.agentReachability}
              {instance.diagnostic && ` · ${instance.diagnostic.replaceAll('_', ' ')}`}
            </p>
          </div>
        ))}
      </div>
      {runtime.healthHistory.length > 0 && (
        <details>
          <summary className="text-xs cursor-pointer">Recent health transitions</summary>
          <ol className="mt-2 space-y-2">
            {runtime.healthHistory.slice(0, 12).map((event) => (
              <li className="text-xs text-muted" key={event.sequence}>
                <time dateTime={event.observedAt}>
                  {new Date(event.observedAt).toLocaleString()}
                </time>
                {' · '}
                {event.nodeName} / {event.instanceId.slice(0, 8)} · process {event.process} ·
                startup {event.startup} · readiness {event.readiness} · liveness {event.liveness} ·
                recovery {event.recovery} ({event.restartAttempts})
                {event.diagnostic && ` · ${event.diagnostic.replaceAll('_', ' ')}`}
              </li>
            ))}
          </ol>
        </details>
      )}
    </section>
  )
}
