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
      className="button primary [display:inline-flex] [align-items:center] [justify-content:center] [gap:8px] [font-size:11px] [font-weight:600] [line-height:1] [white-space:nowrap] [border:1px_solid_transparent] [border-radius:6px] [padding:12px_15px] [&.primary]:[background:#ff8a4c] [&.primary]:[color:#1b100a] [&.primary]:[border-color:#ff8a4c] [&.primary:hover]:[background:#ffa36c] [&.secondary]:[background:light-dark(#e4e4e7,_#1b1b1e)] [&.secondary]:[border-color:light-dark(#d4d4d8,_#38383c)] [&.secondary]:[color:light-dark(#27272a,_#e7e7eb)] [&.secondary:hover]:[background:light-dark(#e4e4e7,_#1b1b1e)]"
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
