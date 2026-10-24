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
          className="button"
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
