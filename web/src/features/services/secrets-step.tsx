import { CreationSecrets } from '../../creation-secrets'

import { Link } from '@tanstack/react-router'

import type { ServiceFormState } from './use-service-form'
export function SecretsStep({
  baseline,
  secretsDraft,
  creationLocked,
}: Pick<ServiceFormState, 'baseline' | 'secretsDraft' | 'creationLocked'>) {
  return (
    <section className="panel form-section [background:light-dark(#f4f4f5,_#131315)] [border:1px_solid_light-dark(#e4e4e7,_#28282c)] [border-radius:8px] [box-shadow:0_1px_0_#ffffff04_inset,_0_8px_24px_#0000000d] [padding:25px] [&_h2]:[display:flex] [&_h2]:[align-items:center] [&_h2]:[gap:10px] [&_h2]:[margin-bottom:23px] max-[720px]:[padding:20px]">
      <h2>
        <span className="step [font-family:var(--font-mono)] [font-size:10px] [color:light-dark(#52525b,_#8d8d95)] [border:1px_solid_light-dark(#d4d4d8,_#38383c)] [border-radius:5px] [padding:4px_6px]">
          05
        </span>{' '}
        Secrets
      </h2>
      <div className="space-y-4">
        {baseline ? (
          <Link
            to="/services/$serviceId/secrets"
            params={{ serviceId: baseline.id }}
            className="button secondary [display:inline-flex] [align-items:center] [justify-content:center] [gap:8px] [font-size:11px] [font-weight:600] [line-height:1] [white-space:nowrap] [border:1px_solid_transparent] [border-radius:6px] [padding:12px_15px] [&.primary]:[background:#ff8a4c] [&.primary]:[color:#1b100a] [&.primary]:[border-color:#ff8a4c] [&.primary:hover]:[background:#ffa36c] [&.secondary]:[background:light-dark(#e4e4e7,_#1b1b1e)] [&.secondary]:[border-color:light-dark(#d4d4d8,_#38383c)] [&.secondary]:[color:light-dark(#27272a,_#e7e7eb)] [&.secondary:hover]:[background:light-dark(#e4e4e7,_#1b1b1e)]"
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
