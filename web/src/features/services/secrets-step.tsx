import { CreationSecrets } from '../../creation-secrets'

import { Link } from '@tanstack/react-router'

import type { ServiceFormState } from './use-service-form'
export function SecretsStep({
  baseline,
  secretsDraft,
  creationLocked,
}: Pick<ServiceFormState, 'baseline' | 'secretsDraft' | 'creationLocked'>) {
  return (
    <section className="panel form-section">
      <h2>
        <span className="step">05</span> Secrets
      </h2>
      <div className="space-y-4">
        {baseline ? (
          <Link
            to="/services/$serviceId/secrets"
            params={{ serviceId: baseline.id }}
            className="button secondary"
          >
            Manage secrets in OpenBao
          </Link>
        ) : (
          <CreationSecrets ref={secretsDraft} locked={creationLocked} />
        )}
      </div>
    </section>
  )
}
