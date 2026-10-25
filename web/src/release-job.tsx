import { Link } from '@tanstack/react-router'
export interface ReleaseJob {
  id: string
  status: string
  result: { exitCode: number | null } | null
  instanceId: string | null
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
      <span
        className="chip [&[data-state=succeeded]]:[color:#9bd2a8] [&[data-state=succeeded]]:[background:light-dark(#e4e4e7,_#18271d)] [&[data-state=succeeded]]:[border-color:#2d4a35] [&[data-state=failed]]:[color:#ffaaa1] [&[data-state=failed]]:[background:light-dark(#e4e4e7,_#2a1919)] [&[data-state=failed]]:[border-color:#4b2a2a] [&[data-state=interrupted]]:[color:#ffaaa1] [&[data-state=interrupted]]:[background:light-dark(#e4e4e7,_#2a1919)] [&[data-state=interrupted]]:[border-color:#4b2a2a] [&[data-state=running]]:[color:#ffb282] [&[data-state=running]]:[background:#2c1c12] [&[data-state=running]]:[border-color:#4e3120] [&[data-state=queued]]:[color:#ffb282] [&[data-state=queued]]:[background:#2c1c12] [&[data-state=queued]]:[border-color:#4e3120] [display:inline-flex] [align-items:center] [gap:6px] [border:1px_solid_light-dark(#d4d4d8,_#38383c)] [background:light-dark(#e4e4e7,_#1b1b1e)] [color:light-dark(#27272a,_#c3c3ca)] [font-size:10px] [padding:5px_8px] [border-radius:5px] [white-space:nowrap]"
        data-state={failed ? 'failed' : job.status}
      >
        {job.status === 'job'
          ? job.instanceId
            ? 'In progress'
            : 'Queued'
          : (labels[job.status] ?? job.status)}
        {job.result?.exitCode != null && ` · exit ${job.result.exitCode}`}
      </span>
      {job.instanceId && (
        <Link
          className="text-orange-300 hover:underline"
          to="/services/$serviceId/logs"
          params={{ serviceId }}
          search={{ instance: job.instanceId }}
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
