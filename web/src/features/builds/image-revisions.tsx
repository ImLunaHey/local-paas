import { Box } from 'lucide-react'

import type { BuildPanelState } from './use-service-builds'

export function ImageRevisions({ revisions }: Pick<BuildPanelState, 'revisions'>) {
  return (
    <div className="border-t border-line pt-5">
      <h3 className="flex items-center gap-2">
        <Box size={15} />
        Image revisions
      </h3>
      {revisions.isError ? (
        <p className="error-notice mt-3" role="alert">
          {revisions.error.message}
        </p>
      ) : !revisions.data?.length ? (
        <p className="text-xs text-muted mt-3">
          {revisions.isPending
            ? 'Loading revisions…'
            : 'A revision appears only after a successful image push.'}
        </p>
      ) : (
        <div className="space-y-3 mt-3">
          {revisions.data.map((revision) => (
            <div key={revision.id} className="revision-row text-xs">
              <time className="text-muted">{new Date(revision.createdAt).toLocaleString()}</time>
              <code className="block text-accent break-all mt-2">
                {revision.imageRepository}@{revision.imageDigest}
              </code>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
