import { pending, labels } from './job-status'
import type { Run } from './job-types'

import { Link } from '@tanstack/react-router'

import { cn } from 'cn'

import type { Service } from '../../generated/model/service'

import { Button } from '../../components/button'

import type { JobsPanelState } from './use-service-jobs'

export function JobRunRow({
  run,
  cancel,
  service,
}: {
  run: Run
  cancel: JobsPanelState['cancel']
  service: Service
}) {
  return (
    <div key={run.id} className="space-y-3 p-5 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span
          className={cn(
            'text-xs font-medium',
            ['running', 'succeeded'].includes(run.status)
              ? 'text-emerald-300'
              : ['failed', 'timed_out', 'uncertain'].includes(run.status)
                ? 'text-red-300'
                : 'text-zinc-300',
          )}
        >
          {labels[run.status] ?? run.status}
          {run.result?.exitCode != null ? ` · exit ${run.result.exitCode}` : ''}
        </span>
        <time className="text-xs text-muted">{new Date(run.createdAt).toLocaleString()}</time>
      </div>
      <p className="break-all font-mono text-xs text-zinc-300">
        {run.options.command.length ? run.options.command.join(' ') : 'Image default command'}
      </p>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-[11px] text-muted">
          Run {run.id.slice(0, 8)} · revision {run.revisionId.slice(0, 8)}
          {run.node ? ` · ${run.node}` : ''} · limit {run.options.timeoutSeconds}s
          {run.cleanupPending ? ' · cleanup pending' : ''}
        </span>
        <div className="flex items-center gap-2">
          {run.instanceId && (
            <Link
              className="button"
              to="/services/$serviceId/logs"
              params={{ serviceId: service.id }}
              search={{ instance: run.instanceId }}
            >
              View logs
            </Link>
          )}
          {pending(run) && (
            <Button disabled={cancel.isPending} onClick={() => cancel.mutate(run.id)}>
              Cancel run
            </Button>
          )}
        </div>
      </div>
      {run.status === 'uncertain' && (
        <p className="text-xs text-muted">
          The node could not prove the outcome. Check logs and external effects before starting
          another run.
        </p>
      )}
      {run.errorCode === 'job_setup_failed' && (
        <p className="text-xs text-red-300">
          Job setup failed. Review the instance logs and secret availability.
        </p>
      )}
      {run.result?.outcome === 'failed' && run.result.exitCode == null && (
        <p className="text-xs text-red-300">
          The job could not be prepared. Check image availability, attached storage, and credentials
          before retrying.
        </p>
      )}
    </div>
  )
}
