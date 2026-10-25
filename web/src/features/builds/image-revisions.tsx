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
        <p
          className="error-notice mt-3 [border:1px_solid_#4d2b2d] [background:light-dark(#f4f4f5,_#231719)] [border-radius:7px] [padding:18px] [font-size:12px] [color:#ffb4ae] [line-height:1.8] [overflow-wrap:anywhere] [&_p]:[margin-top:5px]"
          role="alert"
        >
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
            <div
              key={revision.id}
              className="revision-row text-xs [border:1px_solid_light-dark(#d4d4d8,_#2c2c30)] [border-radius:6px] [padding:14px] [background:light-dark(#f4f4f5,_#19191b)] [&_code]:[color:light-dark(#27272a,_#d5d5dc)]"
            >
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
