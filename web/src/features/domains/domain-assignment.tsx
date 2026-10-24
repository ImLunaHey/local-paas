import { DomainAssignmentForm } from './domain-assignment-form'
import type { Domain } from './domain-types'
import { useDomainAssignment } from './use-domain-assignment'

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
    <section className="panel p-5" aria-label={domain.hostname}>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="break-all">{domain.hostname}</h2>
          <p className="mt-2 text-xs text-muted">
            {domain.serviceId
              ? `${domain.project} / ${domain.environment} → ${domain.service}`
              : 'Unassigned'}
          </p>
        </div>
        <span className="chip">Pending edge setup</span>
      </div>
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
        <p role="alert" className="error-notice mt-4">
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
