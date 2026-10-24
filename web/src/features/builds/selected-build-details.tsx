import { errors } from './build-errors'
import { active } from './build-status'

import { Button } from '../../components/button'

import { X } from 'lucide-react'

import type { BuildPanelState } from './use-service-builds'

export function SelectedBuildDetails({
  selected,
  cancel,
}: {
  selected: NonNullable<BuildPanelState['selected']>
  cancel: BuildPanelState['cancel']
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap justify-between items-center gap-3">
        <span className="flex gap-2 items-center">
          <span className="chip" data-testid="build-status" data-state={selected.status}>
            {selected.cancelRequested && active(selected)
              ? 'Cancellation requested'
              : selected.status}
          </span>
          <span className="text-xs text-muted">
            {selected.noCache ? 'Cache bypassed' : 'Cache allowed'}
          </span>
        </span>
        {active(selected) && (
          <Button
            variant="secondary"
            disabled={cancel.isPending || selected.cancelRequested}
            onClick={() => cancel.mutate(selected.id)}
          >
            <X size={14} />
            Cancel build
          </Button>
        )}
      </div>
      {selected.resolvedCommit && (
        <p className="text-xs text-muted break-all">
          Resolved commit <code>{selected.resolvedCommit}</code>
        </p>
      )}
      {selected.buildPlan?.kind === 'generated' && (
        <details className="text-xs min-w-0">
          <summary className="cursor-pointer text-accent">
            Generated Dockerfile · {selected.buildPlan.runtime} ·{' '}
            {selected.buildPlan.packageManager}
          </summary>
          <pre className="spec-preview mt-3" aria-label="Generated Dockerfile">
            {selected.buildPlan.dockerfile}
          </pre>
          <p className="text-muted mt-2">
            Saved with this build. Dotenv files, .npmrc and local dependencies are excluded when
            copying the app into the image.
          </p>
        </details>
      )}
      {selected.buildPlan?.kind === 'dockerfile' && (
        <p className="text-xs text-muted">
          Repository Dockerfile: <code>{selected.buildPlan.path}</code>
        </p>
      )}
      {selected.errorCode && (
        <p className="error-notice">{errors[selected.errorCode] ?? selected.errorCode}</p>
      )}
      {selected.status === 'queued' && (
        <p className="text-xs text-muted">
          Saved in the build queue. Waiting for the worker to claim it.
        </p>
      )}
      {selected.status === 'succeeded' && (
        <p className="text-xs text-accent">
          Image pushed and revision recorded. Use Deploy revision to start this image.
        </p>
      )}
    </div>
  )
}
