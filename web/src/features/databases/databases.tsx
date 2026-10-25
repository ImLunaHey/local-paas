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
          <div className="page-heading [display:flex] [justify-content:space-between] [align-items:center] [gap:24px] [margin-bottom:30px] [&_p]:[color:light-dark(#52525b,_#a0a0a8)] [&_p]:[font-size:12px] [&_p]:[margin-top:12px] max-[720px]:[align-items:start] max-[720px]:[flex-direction:column] max-[720px]:[gap:20px]">
            <div>
              <div className="eyebrow [font-size:9px] [letter-spacing:1.7px] [color:light-dark(#52525b,_#8d8d95)] [font-weight:600] [text-transform:uppercase] [margin-bottom:13px]">
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
      <form
        className="panel max-w-3xl space-y-5 p-6 [background:light-dark(#f4f4f5,_#131315)] [border:1px_solid_light-dark(#e4e4e7,_#28282c)] [border-radius:8px] [box-shadow:0_1px_0_#ffffff04_inset,_0_8px_24px_#0000000d]"
        onSubmit={submit}
      >
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
          <p
            role="alert"
            className="error-notice [border:1px_solid_#4d2b2d] [background:light-dark(#f4f4f5,_#231719)] [border-radius:7px] [padding:18px] [font-size:12px] [color:#ffb4ae] [line-height:1.8] [overflow-wrap:anywhere] [&_p]:[margin-top:5px]"
          >
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
