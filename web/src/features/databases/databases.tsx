import { DatabaseSubmitButton } from './database-submit-button'
import { DatabaseResourceFields } from './database-resource-fields'
import { DatabaseEngineField } from './database-engine-field'
import { useDatabaseForm } from './use-database-form'

import { Database } from 'lucide-react'

import type { Service } from '../../generated/model/service'

import { ProjectBackLink } from '../../projects'
export function DatabaseForm({
  service,
  initialEngine = 'postgres-service',
}: {
  service?: Service
  initialEngine?: 'postgres-service' | 'rustfs-service'
}) {
  const { scope, engine, setEngine, pg, capabilities, mutation, submit } = useDatabaseForm({
    service,
    initialEngine,
  })
  return (
    <>
      {!service && (
        <>
          <ProjectBackLink project={scope.project} environment={scope.environment} />
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                {engine === 'rustfs-service' ? 'NEW STORAGE' : 'NEW DATABASE'}
              </div>
              <h1>{engine === 'rustfs-service' ? 'Create S3 storage' : 'Create a database'}</h1>
              <p>
                {engine === 'rustfs-service'
                  ? 'Private S3-compatible storage with buckets and scoped access.'
                  : 'A private database with a persistent volume on one worker.'}
              </p>
            </div>
          </div>
        </>
      )}
      <form className="panel max-w-3xl space-y-5 p-6" onSubmit={submit}>
        <div className="flex items-center gap-3">
          <Database size={21} className="text-accent" />
          <h2>
            {service
              ? engine === 'rustfs-service'
                ? 'Object storage configuration'
                : 'Database configuration'
              : 'Choose an engine'}
          </h2>
        </div>
        <DatabaseEngineField
          engine={engine}
          setEngine={setEngine}
          service={service}
          initialEngine={initialEngine}
        />
        <DatabaseResourceFields service={service} scope={scope} engine={engine} pg={pg} />
        <p className="text-xs leading-relaxed text-muted">
          A password is generated in OpenBao at first deployment. The database stays on its owning
          worker and cannot automatically move to another node. Deploying again requires a confirmed
          stop first. Storage and database name cannot change after allocation.
        </p>
        <p className="text-xs text-orange-300">
          Development database: configure and test backups before storing important data.
        </p>
        {mutation.error && (
          <p role="alert" className="error-notice">
            {mutation.error.message}
          </p>
        )}
        {mutation.isSuccess && service && <p role="status">Database configuration saved.</p>}
        <DatabaseSubmitButton
          service={service}
          mutation={mutation}
          capabilities={capabilities}
          engine={engine}
        />
      </form>
    </>
  )
}
