import type { Service } from '../../generated/model/service'

import { Field } from '../../components/field'

import { Select } from '../../components/select'

import type { DatabaseFormState } from './use-database-form'

export function DatabaseEngineField({
  engine,
  setEngine,
  service,
  initialEngine,
}: Pick<DatabaseFormState, 'engine' | 'setEngine'> & {
  service?: Service
  initialEngine: 'postgres-service' | 'rustfs-service'
}) {
  return (
    <Field label={engine === 'rustfs-service' ? 'Storage engine' : 'Database engine'}>
      <Select
        value={engine}
        disabled={!!service}
        onChange={(e) => setEngine(e.target.value as typeof engine)}
      >
        {initialEngine !== 'rustfs-service' && engine !== 'rustfs-service' ? (
          <>
            <option value="postgres-service">PostgreSQL 18 · relational database</option>
            <option value="redis-service">Redis 8 · cache and key-value store</option>
          </>
        ) : (
          <option value="rustfs-service">RustFS · S3 object storage</option>
        )}
      </Select>
    </Field>
  )
}
