import { DatabaseIdentityFields } from './database-identity-fields'

import type { Service } from '../../generated/model/service'

import { Field } from '../../components/field'
import { Input } from '../../components/input'

import type { DatabaseFormState } from './use-database-form'

export function DatabaseResourceFields({
  service,
  scope,
  engine,
  pg,
}: Pick<DatabaseFormState, 'scope' | 'engine' | 'pg'> & { service?: Service }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <DatabaseIdentityFields service={service} scope={scope} engine={engine} pg={pg} />
      <Field label="CPU (millicores)">
        <Input
          name="cpu"
          required
          type="number"
          min={100}
          max={1000}
          defaultValue={service?.spec.resources.cpuMillis ?? 250}
        />
      </Field>
      <Field label="Memory (MiB)">
        <Input
          name="memory"
          required
          type="number"
          min={engine === 'rustfs-service' ? 1024 : 256}
          key={engine}
          max={1400}
          defaultValue={
            service?.spec.resources.memoryMib ?? (engine === 'rustfs-service' ? 1024 : 512)
          }
        />
      </Field>
      <Field label="Persistent storage (GiB)">
        <Input
          name="storage"
          required
          type="number"
          min={1}
          max={2}
          readOnly={!!service}
          defaultValue={
            service?.spec.workload.kind === 'redis-service' ||
            service?.spec.workload.kind === 'rustfs-service'
              ? service.spec.workload.storageGib
              : (pg?.storageGib ?? 1)
          }
        />
      </Field>
    </div>
  )
}
