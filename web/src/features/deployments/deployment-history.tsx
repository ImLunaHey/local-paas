import { PreDeployResult } from '../../release-job'
import { Button } from '../../components/button'

import type { Service } from '../../generated/model/service'

import type { DeploymentPanelState } from './use-deployment-panel'

export function DeploymentHistory({
  runtime,
  stop,
  rollback,
  service,
}: Pick<DeploymentPanelState, 'runtime' | 'stop' | 'rollback'> & { service: Service }) {
  return runtime.data?.deployments.slice(0, 5).map((d) => (
    <div
      key={d.id}
      className="revision-row flex flex-wrap items-center justify-between gap-3 [border:1px_solid_light-dark(#d4d4d8,_#2c2c30)] [border-radius:6px] [padding:14px] [background:light-dark(#f4f4f5,_#19191b)] [&_code]:[color:light-dark(#27272a,_#d5d5dc)]"
    >
      <div>
        <span
          className="chip [&[data-state=succeeded]]:[color:#9bd2a8] [&[data-state=succeeded]]:[background:light-dark(#e4e4e7,_#18271d)] [&[data-state=succeeded]]:[border-color:#2d4a35] [&[data-state=failed]]:[color:#ffaaa1] [&[data-state=failed]]:[background:light-dark(#e4e4e7,_#2a1919)] [&[data-state=failed]]:[border-color:#4b2a2a] [&[data-state=interrupted]]:[color:#ffaaa1] [&[data-state=interrupted]]:[background:light-dark(#e4e4e7,_#2a1919)] [&[data-state=interrupted]]:[border-color:#4b2a2a] [&[data-state=running]]:[color:#ffb282] [&[data-state=running]]:[background:#2c1c12] [&[data-state=running]]:[border-color:#4e3120] [&[data-state=queued]]:[color:#ffb282] [&[data-state=queued]]:[background:#2c1c12] [&[data-state=queued]]:[border-color:#4e3120] [display:inline-flex] [align-items:center] [gap:6px] [border:1px_solid_light-dark(#d4d4d8,_#38383c)] [background:light-dark(#e4e4e7,_#1b1b1e)] [color:light-dark(#27272a,_#c3c3ca)] [font-size:10px] [padding:5px_8px] [border-radius:5px] [white-space:nowrap]"
          data-state={d.status === 'active' ? 'succeeded' : d.status}
        >
          {d.status === 'releasing' ? 'Pre-deploy' : d.status}
        </span>
        <code className="text-xs ml-3">{d.id.slice(0, 8)}</code>
        <p className="text-xs text-muted mt-2">
          {new Date(d.createdAt).toLocaleString()}
          {d.errorCode && ` · ${d.errorCode.replaceAll('_', ' ')}`}
          {d.edgePhase && ` · edge ${d.edgePhase.replaceAll('_', ' ')}`}
        </p>
        {d.preDeploy && <PreDeployResult job={d.preDeploy} serviceId={service.id} />}
      </div>
      {d.edgePhase && ['promoting', 'draining'].includes(d.edgePhase) ? (
        <Button disabled={rollback.isPending} onClick={() => rollback.mutate(d.id)}>
          Roll back public route
        </Button>
      ) : (
        ['releasing', 'waiting', 'preparing', 'active'].includes(d.status) && (
          <Button disabled={stop.isPending} onClick={() => stop.mutate(d.id)}>
            {d.status === 'waiting' ? 'Cancel replacement' : 'Stop deployment'}
          </Button>
        )
      )}
    </div>
  ))
}
