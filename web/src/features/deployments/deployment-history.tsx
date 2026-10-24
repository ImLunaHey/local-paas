import { PreDeployResult } from '../../release-job'
import { Button } from '../../components/button'

import type { Service } from '../../generated/model/service'

import type { DeploymentPanelState } from './use-deployment-panel'

export function DeploymentHistory({
  runtime,
  stop,
  service,
}: Pick<DeploymentPanelState, 'runtime' | 'stop'> & { service: Service }) {
  return runtime.data?.deployments.slice(0, 5).map((d) => (
    <div key={d.id} className="revision-row flex flex-wrap items-center justify-between gap-3">
      <div>
        <span className="chip" data-state={d.status === 'active' ? 'succeeded' : d.status}>
          {d.status === 'releasing' ? 'Pre-deploy' : d.status}
        </span>
        <code className="text-xs ml-3">{d.id.slice(0, 8)}</code>
        <p className="text-xs text-muted mt-2">
          {new Date(d.createdAt).toLocaleString()}
          {d.errorCode && ` · ${d.errorCode.replaceAll('_', ' ')}`}
        </p>
        {d.preDeploy && <PreDeployResult job={d.preDeploy} serviceId={service.id} />}
      </div>
      {['releasing', 'waiting', 'preparing', 'active'].includes(d.status) && (
        <Button disabled={stop.isPending} onClick={() => stop.mutate(d.id)}>
          {d.status === 'waiting' ? 'Cancel replacement' : 'Stop deployment'}
        </Button>
      )}
    </div>
  ))
}
