import { DomainAssignmentForm } from './domain-assignment-form'
import type { DomainObservation as Domain } from '../../generated/model/domainObservation'
import { useDomainAssignment } from './use-domain-assignment'
import { EdgeStatus } from './edge-status'
import { edgeLabel } from './edge-label'

import { Link } from '@tanstack/react-router'
import { ArrowRight } from 'lucide-react'

export function DomainAssignment({ domain }: { domain: Domain }) {
  const {
    project,
    setProject,
    environment,
    setEnvironment,
    service,
    setService,
    projects,
    detail,
    services,
    save,
  } = useDomainAssignment({ domain })
  return (
    <section
      className="panel p-5 [background:light-dark(#f4f4f5,_#131315)] [border:1px_solid_light-dark(#e4e4e7,_#28282c)] [border-radius:8px] [box-shadow:0_1px_0_#ffffff04_inset,_0_8px_24px_#0000000d]"
      aria-label={domain.hostname}
    >
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="break-all">{domain.hostname}</h2>
          <p className="mt-2 text-xs text-muted">
            {domain.serviceId
              ? `${domain.project} / ${domain.environment} → ${domain.service}`
              : 'Unassigned'}
          </p>
        </div>
        <span className="chip [&[data-state=succeeded]]:[color:#9bd2a8] [&[data-state=succeeded]]:[background:light-dark(#e4e4e7,_#18271d)] [&[data-state=succeeded]]:[border-color:#2d4a35] [&[data-state=failed]]:[color:#ffaaa1] [&[data-state=failed]]:[background:light-dark(#e4e4e7,_#2a1919)] [&[data-state=failed]]:[border-color:#4b2a2a] [&[data-state=interrupted]]:[color:#ffaaa1] [&[data-state=interrupted]]:[background:light-dark(#e4e4e7,_#2a1919)] [&[data-state=interrupted]]:[border-color:#4b2a2a] [&[data-state=running]]:[color:#ffb282] [&[data-state=running]]:[background:#2c1c12] [&[data-state=running]]:[border-color:#4e3120] [&[data-state=queued]]:[color:#ffb282] [&[data-state=queued]]:[background:#2c1c12] [&[data-state=queued]]:[border-color:#4e3120] [display:inline-flex] [align-items:center] [gap:6px] [border:1px_solid_light-dark(#d4d4d8,_#38383c)] [background:light-dark(#e4e4e7,_#1b1b1e)] [color:light-dark(#27272a,_#c3c3ca)] [font-size:10px] [padding:5px_8px] [border-radius:5px] [white-space:nowrap]">
          {edgeLabel(domain.status)}
        </span>
      </div>
      <EdgeStatus domain={domain} />
      <DomainAssignmentForm
        domain={domain}
        project={project}
        setProject={setProject}
        environment={environment}
        setEnvironment={setEnvironment}
        service={service}
        setService={setService}
        projects={projects}
        detail={detail}
        services={services}
        save={save}
      />
      {(save.error || services.error || detail.error || projects.error) && (
        <p
          role="alert"
          className="error-notice mt-4 [border:1px_solid_#4d2b2d] [background:light-dark(#f4f4f5,_#231719)] [border-radius:7px] [padding:18px] [font-size:12px] [color:#ffb4ae] [line-height:1.8] [overflow-wrap:anywhere] [&_p]:[margin-top:5px]"
        >
          {(save.error || services.error || detail.error || projects.error)?.message}
        </p>
      )}
      {domain.serviceId && (
        <Link
          className="mt-4 inline-flex items-center gap-2 text-xs text-muted hover:text-white"
          to="/services/$serviceId/networking"
          params={{ serviceId: domain.serviceId }}
        >
          Service networking <ArrowRight size={12} />
        </Link>
      )}
    </section>
  )
}
