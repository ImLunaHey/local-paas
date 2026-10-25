import { cn } from 'cn'
import { Button } from '../../components/button'
import { Input } from '../../components/input'

import { Field } from '../../components/field'

import { Box, Check, Workflow } from 'lucide-react'

import type { ServiceFormState } from './use-service-form'
export function ApplicationStep({
  scope,
  baseline,
  spec,
  kind,
  setKind,
  mutation,
}: Pick<ServiceFormState, 'scope' | 'baseline' | 'spec' | 'kind' | 'setKind' | 'mutation'>) {
  return (
    <section className="panel form-section [background:light-dark(#f4f4f5,_#131315)] [border:1px_solid_light-dark(#e4e4e7,_#28282c)] [border-radius:8px] [box-shadow:0_1px_0_#ffffff04_inset,_0_8px_24px_#0000000d] [padding:25px] [&_h2]:[display:flex] [&_h2]:[align-items:center] [&_h2]:[gap:10px] [&_h2]:[margin-bottom:23px] max-[720px]:[padding:20px]">
      <h2>
        <span className="step [font-family:var(--font-mono)] [font-size:10px] [color:light-dark(#52525b,_#8d8d95)] [border:1px_solid_light-dark(#d4d4d8,_#38383c)] [border-radius:5px] [padding:4px_6px]">
          01
        </span>{' '}
        Application
      </h2>
      <div className="grid sm:grid-cols-2 gap-3 mb-6">
        {(['oci-service', 'celld-service'] as const).map((type) => (
          <Button
            type="button"
            disabled={!!baseline}
            aria-pressed={kind === type}
            className={cn(
              'kind-option [display:flex] [align-items:center] [gap:11px] [border:1px_solid_light-dark(#e4e4e7,_#28282c)] [padding:15px] [border-radius:7px] [text-align:left] [color:light-dark(#52525b,_#a0a0a8)] [&.selected]:[background:light-dark(#ffedd5,_#2c1a10)] [&.selected]:[border-color:#ad5831] [&.selected]:[color:light-dark(#27272a,_#e7e7eb)] [&_strong]:[display:block] [&_strong]:[font-size:11px] [&_strong]:[font-weight:500] [&_small]:[display:block] [&_small]:[font-size:9px] [&_small]:[color:light-dark(#52525b,_#a0a0a8)] [&_small]:[margin-top:5px]',
              { selected: kind === type },
            )}
            key={type}
            onClick={() => {
              setKind(type)
              mutation.reset()
            }}
          >
            {type === 'oci-service' ? <Box size={20} /> : <Workflow size={20} />}
            <span>
              <strong>{type === 'oci-service' ? 'Dockerfile service' : 'celld application'}</strong>
              <small>
                {type === 'oci-service'
                  ? 'Web apps, APIs & background workers'
                  : 'Workers & Durable Objects'}
              </small>
            </span>
            {kind === type && <Check size={15} className="ml-auto text-accent" />}
          </Button>
        ))}
      </div>
      <div className="grid sm:grid-cols-2 gap-4">
        <input type="hidden" name="project" value={spec?.project ?? scope.project ?? ''} />
        <input
          type="hidden"
          name="environment"
          value={spec?.environment ?? scope.environment ?? ''}
        />
        <div className="sm:col-span-2">
          <Field label="Service name">
            <Input
              name="name"
              defaultValue={spec?.name}
              placeholder={kind === 'oci-service' ? 'my-web-app' : 'my-durable-app'}
              required
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
              maxLength={63}
            />
          </Field>
        </div>
      </div>
    </section>
  )
}
