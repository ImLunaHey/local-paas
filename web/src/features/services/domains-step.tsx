import { ServiceDomains } from '../../service-domains'

import type { ServiceFormState } from './use-service-form'
export function DomainsStep({
  baseline,
  setDirty,
  worker,
}: Pick<ServiceFormState, 'baseline' | 'setDirty' | 'worker'>) {
  return (
    <section className="panel form-section">
      <h2>
        <span className="step">04</span> Domains
      </h2>
      <div className="space-y-4">
        {worker ? (
          <p className="text-sm text-muted">
            Background workers do not accept inbound HTTP traffic or domain mappings.
          </p>
        ) : (
          <ServiceDomains serviceId={baseline?.id} onChange={() => setDirty(true)} />
        )}
      </div>
    </section>
  )
}
