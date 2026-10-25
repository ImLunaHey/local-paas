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
          className="chip [&[data-state=succeeded]]:[color:#9bd2a8] [&[data-state=succeeded]]:[background:light-dark(#e4e4e7,_#18271d)] [&[data-state=succeeded]]:[border-color:#2d4a35] [&[data-state=failed]]:[color:#ffaaa1] [&[data-state=failed]]:[background:light-dark(#e4e4e7,_#2a1919)] [&[data-state=failed]]:[border-color:#4b2a2a] [&[data-state=interrupted]]:[color:#ffaaa1] [&[data-state=interrupted]]:[background:light-dark(#e4e4e7,_#2a1919)] [&[data-state=interrupted]]:[border-color:#4b2a2a] [&[data-state=running]]:[color:#ffb282] [&[data-state=running]]:[background:#2c1c12] [&[data-state=running]]:[border-color:#4e3120] [&[data-state=queued]]:[color:#ffb282] [&[data-state=queued]]:[background:#2c1c12] [&[data-state=queued]]:[border-color:#4e3120] [display:inline-flex] [align-items:center] [gap:6px] [border:1px_solid_light-dark(#d4d4d8,_#38383c)] [background:light-dark(#e4e4e7,_#1b1b1e)] [color:light-dark(#27272a,_#c3c3ca)] [font-size:10px] [padding:5px_8px] [border-radius:5px] [white-space:nowrap]"
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
                className="chip [&[data-state=succeeded]]:[color:#9bd2a8] [&[data-state=succeeded]]:[background:light-dark(#e4e4e7,_#18271d)] [&[data-state=succeeded]]:[border-color:#2d4a35] [&[data-state=failed]]:[color:#ffaaa1] [&[data-state=failed]]:[background:light-dark(#e4e4e7,_#2a1919)] [&[data-state=failed]]:[border-color:#4b2a2a] [&[data-state=interrupted]]:[color:#ffaaa1] [&[data-state=interrupted]]:[background:light-dark(#e4e4e7,_#2a1919)] [&[data-state=interrupted]]:[border-color:#4b2a2a] [&[data-state=running]]:[color:#ffb282] [&[data-state=running]]:[background:#2c1c12] [&[data-state=running]]:[border-color:#4e3120] [&[data-state=queued]]:[color:#ffb282] [&[data-state=queued]]:[background:#2c1c12] [&[data-state=queued]]:[border-color:#4e3120] [display:inline-flex] [align-items:center] [gap:6px] [border:1px_solid_light-dark(#d4d4d8,_#38383c)] [background:light-dark(#e4e4e7,_#1b1b1e)] [color:light-dark(#27272a,_#c3c3ca)] [font-size:10px] [padding:5px_8px] [border-radius:5px] [white-space:nowrap]"
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
