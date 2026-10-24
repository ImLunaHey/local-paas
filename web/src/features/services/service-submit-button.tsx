import { Button } from '../../components/button'

import { Check, LoaderCircle, Plus } from 'lucide-react'

import type { ServiceFormState } from './use-service-form'

function submitLabel({
  saving,
  editing,
  retrying,
  kind,
}: {
  saving: boolean
  editing: boolean
  retrying: boolean
  kind: string
}) {
  if (saving) return editing ? 'Saving…' : 'Registering…'
  if (editing) return 'Save changes'
  if (retrying) return 'Retry creation'
  return kind === 'oci-service' ? 'Create and build' : 'Create service'
}

export function ServiceSubmitButton({
  baseline,
  sourceMode,
  uploadDigest,
  dirty,
  domainsReady,
  creationLocked,
  kind,
  worker,
  mutation,
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
>) {
  return (
    <Button
      type="submit"
      className="button primary"
      disabled={
        (!worker && !domainsReady) ||
        mutation.isPending ||
        (!!baseline && !dirty) ||
        (kind === 'oci-service' && sourceMode === 'upload' && !uploadDigest)
      }
    >
      {mutation.isPending ? (
        <LoaderCircle className="animate-spin" size={16} />
      ) : baseline ? (
        <Check size={16} />
      ) : (
        <Plus size={16} />
      )}
      {submitLabel({
        saving: mutation.isPending,
        editing: !!baseline,
        retrying: creationLocked,
        kind,
      })}
    </Button>
  )
}
