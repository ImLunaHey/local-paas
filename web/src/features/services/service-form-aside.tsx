import { ArrowDownLeft, ShieldCheck } from 'lucide-react'

import type { ServiceFormState } from './use-service-form'

export function ServiceFormAside({ baseline, kind }: Pick<ServiceFormState, 'baseline' | 'kind'>) {
  return (
    <aside className="form-aside">
      <span className="service-icon mb-5">
        <ArrowDownLeft size={22} />
      </span>
      <h3>{baseline ? 'Configure your service.' : 'A specification, then a deployment.'}</h3>
      <p>
        {baseline
          ? 'Changes apply to future builds. Existing builds and image revisions keep their recorded configuration. Saving does not start a build or deploy a workload.'
          : 'Create your service, save its secrets in OpenBao, and start its first build.'}
      </p>
      <div className="aside-divider" />
      <h4>What happens next?</h4>
      <p>
        {kind === 'oci-service'
          ? 'The build pipeline will turn this source and Dockerfile into an immutable OCI image before scheduling instances.'
          : 'A dedicated deployment runner will validate Wrangler, deploy the application, and coordinate its fleet.'}
      </p>
      <div className="aside-divider" />
      <span className="flex gap-2 text-xs text-muted">
        <ShieldCheck size={15} className="shrink-0" />
        Secrets stay out of images and build logs.
      </span>
    </aside>
  )
}
