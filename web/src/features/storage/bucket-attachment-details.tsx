import { Link } from '@tanstack/react-router'
import type { Service } from '../../generated/model/service'
import { Button } from '../../components/button'
import type { BucketPanelState } from './use-bucket-attachment'

export function BucketAttachmentDetails({
  current,
  state,
  detach,
  service,
}: Pick<BucketPanelState, 'current' | 'state' | 'detach'> & { service: Service }) {
  return (
    current && (
      <>
        <Link
          className="button [display:inline-flex] [align-items:center] [justify-content:center] [gap:8px] [font-size:11px] [font-weight:600] [line-height:1] [white-space:nowrap] [border:1px_solid_transparent] [border-radius:6px] [padding:12px_15px] [&.primary]:[background:#ff8a4c] [&.primary]:[color:#1b100a] [&.primary]:[border-color:#ff8a4c] [&.primary:hover]:[background:#ffa36c] [&.secondary]:[background:light-dark(#e4e4e7,_#1b1b1e)] [&.secondary]:[border-color:light-dark(#d4d4d8,_#38383c)] [&.secondary]:[color:light-dark(#27272a,_#e7e7eb)] [&.secondary:hover]:[background:light-dark(#e4e4e7,_#1b1b1e)]"
          to="/services/$serviceId/storage"
          params={{ serviceId: service.id }}
          search={{ browse: 'objects' }}
        >
          Browse files
        </Link>
        <p className="text-sm">
          Attached: {current.storage} / {current.name} ·{' '}
          {state.data?.binding?.readOnly ? 'read only' : 'read/write'}
        </p>
        <div className="space-y-2">
          <Button disabled={detach.isPending} onClick={() => detach.mutate()}>
            Detach bucket
          </Button>
          <p className="text-xs text-muted">
            Detaching immediately revokes this app’s access. Bucket contents remain intact.
          </p>
        </div>
      </>
    )
  )
}
