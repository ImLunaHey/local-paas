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
          className="button secondary [display:inline-flex] [align-items:center] [justify-content:center] [gap:8px] [font-size:11px] [font-weight:600] [line-height:1] [white-space:nowrap] [border:1px_solid_transparent] [border-radius:6px] [padding:12px_15px] [&.primary]:[background:#ff8a4c] [&.primary]:[color:#1b100a] [&.primary]:[border-color:#ff8a4c] [&.primary:hover]:[background:#ffa36c] [&.secondary]:[background:light-dark(#e4e4e7,_#1b1b1e)] [&.secondary]:[border-color:light-dark(#d4d4d8,_#38383c)] [&.secondary]:[color:light-dark(#27272a,_#e7e7eb)] [&.secondary:hover]:[background:light-dark(#e4e4e7,_#1b1b1e)]"
          onClick={() => {
            void reloadSaved()
          }}
        >
          Reload saved configuration
        </Button>
      ) : (
        <Link
          to="/app"
          className="button secondary [display:inline-flex] [align-items:center] [justify-content:center] [gap:8px] [font-size:11px] [font-weight:600] [line-height:1] [white-space:nowrap] [border:1px_solid_transparent] [border-radius:6px] [padding:12px_15px] [&.primary]:[background:#ff8a4c] [&.primary]:[color:#1b100a] [&.primary]:[border-color:#ff8a4c] [&.primary:hover]:[background:#ffa36c] [&.secondary]:[background:light-dark(#e4e4e7,_#1b1b1e)] [&.secondary]:[border-color:light-dark(#d4d4d8,_#38383c)] [&.secondary]:[color:light-dark(#27272a,_#e7e7eb)] [&.secondary:hover]:[background:light-dark(#e4e4e7,_#1b1b1e)]"
        >
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
