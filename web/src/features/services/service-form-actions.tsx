import { ServiceSubmitButton } from './service-submit-button'

import { Button } from '../../components/button'

import { Link } from '@tanstack/react-router'

import type { ServiceFormState } from './use-service-form'

export function ServiceFormActions({
  baseline,
  sourceMode,
  uploadDigest,
  dirty,
  domainsReady,
  creationLocked,
  kind,
  worker,
  mutation,
  reloadSaved,
}: Pick<
  ServiceFormState,
  | 'baseline'
  | 'sourceMode'
  | 'uploadDigest'
  | 'dirty'
  | 'domainsReady'
  | 'creationLocked'
  | 'kind'
  | 'worker'
  | 'mutation'
  | 'reloadSaved'
>) {
  return (
    <div className="flex items-center justify-between gap-3">
      {baseline ? (
        <Button
          type="button"
          className="button secondary"
          onClick={() => {
            void reloadSaved()
          }}
        >
          Reload saved configuration
        </Button>
      ) : (
        <Link to="/app" className="button secondary">
          Cancel
        </Link>
      )}
      <ServiceSubmitButton
        baseline={baseline}
        sourceMode={sourceMode}
        uploadDigest={uploadDigest}
        dirty={dirty}
        domainsReady={domainsReady}
        creationLocked={creationLocked}
        kind={kind}
        worker={worker}
        mutation={mutation}
      />
    </div>
  )
}
