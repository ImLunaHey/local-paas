import { ServiceFormFeedback } from './service-form-feedback'
import { ServiceFormActions } from './service-form-actions'
import { ServiceFormAside } from './service-form-aside'
import { SecretsStep } from './secrets-step'
import { DomainsStep } from './domains-step'
import { RuntimeStep } from './runtime-step'
import { SourceStep } from './source-step'
import { ApplicationStep } from './application-step'
import { useServiceForm } from './use-service-form'

import { ProjectBackLink } from '../../projects'

import type { Service } from '../../generated/model/service'

export function ServiceForm({ service }: { service?: Service }) {
  const form = useServiceForm(service)
  const {
    scope,
    baseline,
    spec,
    oci,
    celld,
    sourceMode,
    setSourceMode,
    uploadDigest,
    setUploadDigest,
    sourceKind,
    setSourceKind,
    sourceValue,
    setSourceValue,
    buildMode,
    setBuildMode,
    execution,
    setExecution,
    dirty,
    setDirty,
    domainsReady,
    secretsDraft,
    creationLocked,
    formVersion,
    reloading,
    reloadError,
    kind,
    setKind,
    worker,
    mutation,
    reloadSaved,
    submit,
  } = form

  return (
    <>
      {!baseline && (
        <>
          <ProjectBackLink project={scope.project} environment={scope.environment} />
          <div className="page-heading">
            <div>
              <div className="eyebrow">NEW SERVICE</div>
              <h1>Give your application a home.</h1>
              <p>Start with its source and the resources it will need.</p>
            </div>
          </div>
        </>
      )}
      <div className="form-layout">
        <form
          key={formVersion}
          onSubmit={submit}
          onChange={() => {
            setDirty(true)
            mutation.reset()
          }}
          className="space-y-5"
          aria-label={baseline ? 'Service configuration' : 'Register service'}
        >
          <fieldset disabled={mutation.isPending || reloading} className="space-y-5">
            <fieldset disabled={creationLocked} className="space-y-5">
              <ApplicationStep
                scope={scope}
                baseline={baseline}
                spec={spec}
                kind={kind}
                setKind={setKind}
                mutation={mutation}
              />
              <SourceStep
                scope={scope}
                spec={spec}
                oci={oci}
                celld={celld}
                sourceMode={sourceMode}
                setSourceMode={setSourceMode}
                uploadDigest={uploadDigest}
                setUploadDigest={setUploadDigest}
                sourceKind={sourceKind}
                setSourceKind={setSourceKind}
                sourceValue={sourceValue}
                setSourceValue={setSourceValue}
                buildMode={buildMode}
                setBuildMode={setBuildMode}
                setDirty={setDirty}
                kind={kind}
              />
              <RuntimeStep
                baseline={baseline}
                spec={spec}
                oci={oci}
                celld={celld}
                execution={execution}
                setExecution={setExecution}
                setDirty={setDirty}
                kind={kind}
                worker={worker}
              />
              <DomainsStep baseline={baseline} setDirty={setDirty} worker={worker} />
            </fieldset>
            <SecretsStep
              baseline={baseline}
              secretsDraft={secretsDraft}
              creationLocked={creationLocked}
            />
            <ServiceFormFeedback
              baseline={baseline}
              mutation={mutation}
              dirty={dirty}
              creationLocked={creationLocked}
              reloadError={reloadError}
            />
            <ServiceFormActions
              baseline={baseline}
              sourceMode={sourceMode}
              uploadDigest={uploadDigest}
              dirty={dirty}
              domainsReady={domainsReady}
              creationLocked={creationLocked}
              kind={kind}
              worker={worker}
              mutation={mutation}
              reloadSaved={reloadSaved}
            />
          </fieldset>
        </form>
        <ServiceFormAside baseline={baseline} kind={kind} />
      </div>
    </>
  )
}
