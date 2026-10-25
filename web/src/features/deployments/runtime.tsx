import { DeploymentControls } from './deployment-controls'
import { DeploymentHistory } from './deployment-history'
import { RuntimeHealth } from './runtime-health'
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
    <section
      className="panel p-6 mb-7 space-y-4 [background:light-dark(#f4f4f5,_#131315)] [border:1px_solid_light-dark(#e4e4e7,_#28282c)] [border-radius:8px] [box-shadow:0_1px_0_#ffffff04_inset,_0_8px_24px_#0000000d]"
      aria-label="Deployments"
    >
      <div className="section-heading [display:flex] [justify-content:space-between] [align-items:center] [margin-bottom:15px] [gap:12px] max-[720px]:[&_.tiny-label]:[font-size:8px] max-[720px]:[&_.tiny-label]:[letter-spacing:0.6px]">
        <h2>Deployments</h2>
        <span className="chip [&[data-state=succeeded]]:[color:#9bd2a8] [&[data-state=succeeded]]:[background:light-dark(#e4e4e7,_#18271d)] [&[data-state=succeeded]]:[border-color:#2d4a35] [&[data-state=failed]]:[color:#ffaaa1] [&[data-state=failed]]:[background:light-dark(#e4e4e7,_#2a1919)] [&[data-state=failed]]:[border-color:#4b2a2a] [&[data-state=interrupted]]:[color:#ffaaa1] [&[data-state=interrupted]]:[background:light-dark(#e4e4e7,_#2a1919)] [&[data-state=interrupted]]:[border-color:#4b2a2a] [&[data-state=running]]:[color:#ffb282] [&[data-state=running]]:[background:#2c1c12] [&[data-state=running]]:[border-color:#4e3120] [&[data-state=queued]]:[color:#ffb282] [&[data-state=queued]]:[background:#2c1c12] [&[data-state=queued]]:[border-color:#4e3120] [display:inline-flex] [align-items:center] [gap:6px] [border:1px_solid_light-dark(#d4d4d8,_#38383c)] [background:light-dark(#e4e4e7,_#1b1b1e)] [color:light-dark(#27272a,_#c3c3ca)] [font-size:10px] [padding:5px_8px] [border-radius:5px] [white-space:nowrap]">
          {runtime.data?.healthyNodes ?? '—'} available workers
        </span>
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
        <p
          role="alert"
          className="error-notice [border:1px_solid_#4d2b2d] [background:light-dark(#f4f4f5,_#231719)] [border-radius:7px] [padding:18px] [font-size:12px] [color:#ffb4ae] [line-height:1.8] [overflow-wrap:anywhere] [&_p]:[margin-top:5px]"
        >
          {error.message}
        </p>
      )}
      {runtime.data && <RuntimeHealth runtime={runtime.data} />}
      {<DeploymentHistory runtime={runtime} stop={stop} rollback={rollback} service={service} />}
      {runtime.data?.previewUrl && runtimeLabel(runtime.data) === 'Running' && (
        <a
          className="back-link [display:inline-flex] [gap:7px] [align-items:center] [font-size:11px] [color:light-dark(#52525b,_#a0a0a8)] [margin-bottom:25px] [&:hover]:[color:light-dark(#27272a,_#e7e7eb)]"
          href={runtime.data.previewUrl}
          target="_blank"
          rel="noreferrer"
        >
          Open application <ExternalLink size={14} />
        </a>
      )}
    </section>
  )
}
