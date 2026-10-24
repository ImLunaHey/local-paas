import { JobForm } from './job-form'
import { labels } from './job-status'

import { Clock3 } from 'lucide-react'
import type { Service } from '../../generated/model/service'
import { Button } from '../../components/button'
import type { Schedule, Jobs } from './job-types'
import type { Revision } from '../../api'
import type { JobsPanelState } from './use-service-jobs'

export function JobSchedule({
  schedule,
  pause,
  revisions,
  service,
  blocked,
  jobs,
}: {
  schedule: Schedule | null
  pause: JobsPanelState['pause']
  revisions: { data: Revision[] }
  service: Service
  blocked: boolean
  jobs: { data: Jobs }
}) {
  return (
    <section className="panel p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2">
            <Clock3 size={16} /> Schedule
          </h2>
          <p className="mt-2 text-xs text-muted">
            {schedule?.status === 'enabled'
              ? `Every ${schedule.intervalMinutes} minutes · next ${new Date(schedule.nextRunAt).toLocaleString()}`
              : schedule
                ? 'Paused'
                : 'No schedule configured'}
          </p>
        </div>
        {schedule?.status === 'enabled' && (
          <Button disabled={pause.isPending} onClick={() => pause.mutate()}>
            Pause schedule
          </Button>
        )}
      </div>
      <p className="mt-4 text-xs leading-relaxed text-muted">
        One job at a time per service. Overlapping occurrences and ticks missed by more than 30
        seconds are recorded as skipped. Pausing prevents future runs; it does not cancel an
        existing job. Schedules are not copied to shadow environments.
      </p>
      {pause.error && (
        <p role="alert" className="error-notice mt-4">
          {pause.error.message}
        </p>
      )}
      {!!revisions.data.length && (
        <details className="mt-5">
          <summary className="cursor-pointer text-xs text-zinc-200">
            {schedule ? 'Edit schedule' : 'Add schedule'}
          </summary>
          <div className="mt-5">
            <JobForm
              key={service.id + ':schedule:' + (schedule?.version ?? 0)}
              service={service}
              revisions={revisions.data}
              schedule={schedule}
              scheduled
              blocked={blocked}
            />
          </div>
        </details>
      )}
      {!!jobs.data.occurrences.length && (
        <details className="mt-5">
          <summary className="cursor-pointer text-xs text-muted">
            Recent schedule occurrences
          </summary>
          <div className="mt-3 divide-y divide-zinc-800">
            {jobs.data.occurrences.map((o) => (
              <div key={o.id} className="flex flex-wrap justify-between gap-2 py-3 text-xs">
                <span className="text-muted">{new Date(o.scheduledAt).toLocaleString()}</span>
                <span>
                  {labels[o.status] ?? o.status}
                  {o.skippedCount > 1 ? ` (${o.skippedCount} occurrences)` : ''}
                </span>
              </div>
            ))}
          </div>
        </details>
      )}
    </section>
  )
}
