import type { Run } from './job-types'
export const pending = (run: Run) =>
  ['queued', 'assigned', 'running', 'unknown'].includes(run.status)
export const labels: Record<string, string> = {
  queued: 'Queued',
  assigned: 'Starting',
  running: 'Running',
  unknown: 'Node unavailable · ownership retained',
  succeeded: 'Succeeded',
  failed: 'Failed',
  timed_out: 'Timed out',
  uncertain: 'Uncertain result · review before retrying',
  cancelled: 'Cancelled',
  skipped_overlap: 'Skipped · previous run still owns its allocation',
  skipped_missed: 'Skipped · missed while scheduler was unavailable',
  failed_to_queue: 'Could not queue · check configuration and secret availability',
}
