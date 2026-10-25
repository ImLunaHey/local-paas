import { DeploymentControls } from './deployment-controls'
import { DeploymentHistory } from './deployment-history'
import { useDeploymentPanel } from './use-deployment-panel'

import { ExternalLink } from 'lucide-react'

import type { Service } from '../../generated/model/service'

import { runtimeLabel } from '../../runtime-query'
export function DeploymentPanel({ service }: { service: Service }) {
  const { runtime, revisions, setChosen, revision, deploy, stop, rollback, error, preparing } =
    useDeploymentPanel({
      service,
    })
  if (service.spec.workload.kind === 'celld-service') return null
  const worker =
    service.spec.workload.kind === 'oci-service' && service.spec.workload.execution === 'worker'
  return (
    <section className="panel p-6 mb-7 space-y-4" aria-label="Deployments">
      <div className="section-heading">
        <h2>Deployments</h2>
        <span className="chip">{runtime.data?.healthyNodes ?? '—'} available workers</span>
      </div>
      <p className="text-xs text-muted">
        {worker
          ? 'Deploying stops the previous worker first. Its replacement waits for confirmed shutdown, including when the old node is unreachable. A failed replacement requires another deployment; the old process is not restarted automatically.'
          : 'Deploy an image revision. Public routes require an edge acknowledgement after readiness. The previous healthy revision remains available during the two-minute rollback window.'}
      </p>
      <DeploymentControls
        revisions={revisions}
        revision={revision}
        setChosen={setChosen}
        deploy={deploy}
        runtime={runtime}
        preparing={preparing}
      />
      {error && (
        <p role="alert" className="error-notice">
          {error.message}
        </p>
      )}
      {<DeploymentHistory runtime={runtime} stop={stop} rollback={rollback} service={service} />}
      {runtime.data?.previewUrl && runtimeLabel(runtime.data) === 'Running' && (
        <a className="back-link" href={runtime.data.previewUrl} target="_blank" rel="noreferrer">
          Open application <ExternalLink size={14} />
        </a>
      )}
    </section>
  )
}
