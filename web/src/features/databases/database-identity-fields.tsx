import type { Service } from '../../generated/model/service'

import { Field } from '../../components/field'
import { Input } from '../../components/input'

import type { DatabaseFormState } from './use-database-form'

export function DatabaseIdentityFields({
  service,
  scope,
  engine,
  pg,
}: Pick<DatabaseFormState, 'scope' | 'engine' | 'pg'> & { service?: Service }) {
  return (
    <>
      <input type="hidden" name="project" value={service?.spec.project ?? scope.project ?? ''} />
      <input
        type="hidden"
        name="environment"
        value={service?.spec.environment ?? scope.environment ?? ''}
      />
      <Field label="Service name">
        <Input
          name="name"
          required
          key={engine}
          defaultValue={
            service?.spec.name ??
            (engine === 'redis-service'
              ? 'redis'
              : engine === 'rustfs-service'
                ? 'storage'
                : 'postgres')
          }
          pattern="[a-z0-9]+(-[a-z0-9]+)*"
        />
      </Field>
      {engine === 'postgres-service' && (
        <Field label="Database name">
          <Input
            name="database"
            required
            readOnly={!!service}
            defaultValue={pg?.database ?? 'app'}
            pattern="[a-z0-9_]+"
            maxLength={63}
          />
        </Field>
      )}
    </>
  )
}
