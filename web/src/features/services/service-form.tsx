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
          <div className="page-heading [display:flex] [justify-content:space-between] [align-items:center] [gap:24px] [margin-bottom:30px] [&_p]:[color:light-dark(#52525b,_#a0a0a8)] [&_p]:[font-size:12px] [&_p]:[margin-top:12px] max-[720px]:[align-items:start] max-[720px]:[flex-direction:column] max-[720px]:[gap:20px]">
            <div>
              <div className="eyebrow [font-size:9px] [letter-spacing:1.7px] [color:light-dark(#52525b,_#8d8d95)] [font-weight:600] [text-transform:uppercase] [margin-bottom:13px]">
                NEW SERVICE
              </div>
              <h1>Give your application a home.</h1>
              <p>Start with its source and the resources it will need.</p>
            </div>
          </div>
        </>
      )}
      <div className="form-layout [display:grid] [grid-template-columns:minmax(0,_1fr)_235px] [gap:32px] max-[1100px]:[grid-template-columns:minmax(0,_1fr)]">
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
