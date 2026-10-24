import { DeploymentControls } from './deployment-controls'
import { DeploymentHistory } from './deployment-history'
import { useDeploymentPanel } from './use-deployment-panel'

import { ExternalLink } from 'lucide-react'

import type { Service } from '../../generated/model/service'

import { runtimeLabel } from '../../runtime-query'
export function DeploymentPanel({ service }: { service: Service }) {
  const { runtime, revisions, setChosen, revision, deploy, stop } = useDeploymentPanel({ service })
  if (service.spec.workload.kind === 'celld-service') return null
  const worker =
    service.spec.workload.kind === 'oci-service' && service.spec.workload.execution === 'worker'
  const preparing = runtime.data?.deployments.some((d) =>
    ['releasing', 'waiting', 'preparing'].includes(d.status),
  )
  return (
    <section className="panel p-6 mb-7 space-y-4" aria-label="Deployments">
      <div className="section-heading">
        <h2>Deployments</h2>
        <span className="chip">{runtime.data?.healthyNodes ?? '—'} available workers</span>
      </div>
      <p className="text-xs text-muted">
        {worker
          ? 'Deploying stops the previous worker first. Its replacement waits for confirmed shutdown, including when the old node is unreachable. A failed replacement requires another deployment; the old process is not restarted automatically.'
          : 'Deploy an image revision. Traffic switches after every candidate passes readiness; the previous healthy deployment stays available until then.'}
      </p>
      <DeploymentControls
        revisions={revisions}
        revision={revision}
        setChosen={setChosen}
        deploy={deploy}
        runtime={runtime}
        preparing={preparing}
      />
      {(deploy.isError || stop.isError || runtime.isError || revisions.isError) && (
        <p role="alert" className="error-notice">
          {(deploy.error || stop.error || runtime.error || revisions.error)?.message}
        </p>
      )}
      {<DeploymentHistory runtime={runtime} stop={stop} service={service} />}
      {runtime.data?.previewUrl && runtimeLabel(runtime.data) === 'Running' && (
        <a className="back-link" href={runtime.data.previewUrl} target="_blank" rel="noreferrer">
          Open application <ExternalLink size={14} />
        </a>
      )}
    </section>
  )
}
