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
    <section className="panel form-section">
      <h2>
        <span className="step">01</span> Application
      </h2>
      <div className="grid sm:grid-cols-2 gap-3 mb-6">
        {(['oci-service', 'celld-service'] as const).map((type) => (
          <Button
            type="button"
            disabled={!!baseline}
            aria-pressed={kind === type}
            className={cn('kind-option', { selected: kind === type })}
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
