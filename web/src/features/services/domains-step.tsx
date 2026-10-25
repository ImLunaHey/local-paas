import { ServiceDomains } from '../../service-domains'

import type { ServiceFormState } from './use-service-form'
export function DomainsStep({
  baseline,
  setDirty,
  worker,
}: Pick<ServiceFormState, 'baseline' | 'setDirty' | 'worker'>) {
  return (
    <section className="panel form-section [background:light-dark(#f4f4f5,_#131315)] [border:1px_solid_light-dark(#e4e4e7,_#28282c)] [border-radius:8px] [box-shadow:0_1px_0_#ffffff04_inset,_0_8px_24px_#0000000d] [padding:25px] [&_h2]:[display:flex] [&_h2]:[align-items:center] [&_h2]:[gap:10px] [&_h2]:[margin-bottom:23px] max-[720px]:[padding:20px]">
      <h2>
        <span className="step [font-family:var(--font-mono)] [font-size:10px] [color:light-dark(#52525b,_#8d8d95)] [border:1px_solid_light-dark(#d4d4d8,_#38383c)] [border-radius:5px] [padding:4px_6px]">
          04
        </span>{' '}
        Domains
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
