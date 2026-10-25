import { errors } from './build-errors'
import { active } from './build-status'

import { Button } from '../../components/button'

import { X } from 'lucide-react'

import type { BuildPanelState } from './use-service-builds'
import type { BuildPlan, RecipeDetection } from '../../api'

function DetectionDetails({ detection }: { detection: RecipeDetection }) {
  return (
    <>
      <dl className="grid gap-2 sm:grid-cols-2 mt-3 text-muted">
        <div>
          <dt>Detection</dt>
          <dd className="text-foreground">
            {detection.detectorVersion} · {detection.confidence} confidence
          </dd>
        </div>
        <div>
          <dt>Required files</dt>
          <dd className="text-foreground">{detection.requiredFiles.join(', ')}</dd>
        </div>
        <div>
          <dt>Build command</dt>
          <dd className="text-foreground">{detection.buildCommand ?? 'Dependency install only'}</dd>
        </div>
        <div>
          <dt>Start command</dt>
          <dd className="text-foreground">{detection.startCommand}</dd>
        </div>
      </dl>
      <p className="text-muted mt-2">{detection.reasons.join(' ')}</p>
      {detection.unsupported.length > 0 && (
        <p className="text-muted mt-2">
          Requires a Dockerfile: {detection.unsupported.join(', ')}.
        </p>
      )}
    </>
  )
}

function BuildPlanDetails({ plan }: { plan: BuildPlan }) {
  if (plan.kind === 'dockerfile') {
    return (
      <div className="text-xs text-muted">
        <p>
          Repository Dockerfile: <code>{plan.path}</code>
        </p>
        {plan.detection && (
          <p>
            {plan.detection.reasons.join(' ')} · {plan.detection.detectorVersion}
          </p>
        )}
      </div>
    )
  }
  return (
    <details className="text-xs min-w-0">
      <summary className="cursor-pointer text-accent">
        Generated Dockerfile · {plan.runtime} · {plan.packageManager}
      </summary>
      {plan.detection && <DetectionDetails detection={plan.detection} />}
      <pre className="spec-preview mt-3" aria-label="Generated Dockerfile">
        {plan.dockerfile}
      </pre>
      <p className="text-muted mt-2">
        Saved with this build. Dotenv files, package credentials and local dependency/build
        directories are excluded when copying the app into the image.
      </p>
    </details>
  )
}

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
      {selected.buildPlan && <BuildPlanDetails plan={selected.buildPlan} />}
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
