import { Link } from '@tanstack/react-router'
export interface ReleaseJob {
  id: string
  status: string
  result: { exit_code: number | null } | null
  instance_id: string | null
}
export function PreDeployResult({ job, serviceId }: { job: ReleaseJob; serviceId: string }) {
  return (
    <div className="flex flex-wrap items-center gap-3 mt-3 text-xs">
      <span className="text-muted">Pre-deploy task</span>
      <span className="chip" data-state={job.status}>
        {job.status === 'job' ? 'In progress' : job.status}
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
