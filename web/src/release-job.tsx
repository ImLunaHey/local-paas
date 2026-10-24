import { Link } from '@tanstack/react-router'
export interface ReleaseJob {
  id: string
  status: string
  result: { exit_code: number | null } | null
  instance_id: string | null
}
export function PreDeployResult({ job, serviceId }: { job: ReleaseJob; serviceId: string }) {
  const labels: Record<string, string> = {
    succeeded: 'Succeeded',
    failed: 'Failed',
    timed_out: 'Timed out',
    cancelled: 'Cancelled',
    uncertain: 'Outcome unknown',
  }
  const failed = ['failed', 'timed_out', 'uncertain'].includes(job.status)
  return (
    <div className="flex flex-wrap items-center gap-3 mt-3 text-xs">
      <span className="text-muted">Pre-deploy task</span>
      <span className="chip" data-state={failed ? 'failed' : job.status}>
        {job.status === 'job'
          ? job.instance_id
            ? 'In progress'
            : 'Queued'
          : (labels[job.status] ?? job.status)}
        {job.result?.exit_code != null && ` · exit ${job.result.exit_code}`}
      </span>
      {job.instance_id && (
        <Link
          className="text-orange-300 hover:underline"
          to="/services/$serviceId/logs"
          params={{ serviceId }}
          search={{ instance: job.instance_id }}
        >
          View task logs
        </Link>
      )}
      {job.status === 'uncertain' && (
        <span className="text-muted">Outcome unknown. Check database state before retrying.</span>
      )}
    </div>
  )
}
