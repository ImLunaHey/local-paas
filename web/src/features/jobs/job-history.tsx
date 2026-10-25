import { JobRunRow } from './job-run-row'

import type { Service } from '../../generated/model/service'

import type { Jobs } from './job-types'
import type { JobsPanelState } from './use-service-jobs'

export function JobHistory({
  jobs,
  cancel,
  service,
}: {
  jobs: { data: Jobs }
  cancel: JobsPanelState['cancel']
  service: Service
}) {
  return (
    <section
      className="panel overflow-hidden [background:light-dark(#f4f4f5,_#131315)] [border:1px_solid_light-dark(#e4e4e7,_#28282c)] [border-radius:8px] [box-shadow:0_1px_0_#ffffff04_inset,_0_8px_24px_#0000000d]"
      aria-label="Job run history"
    >
      <div className="border-b border-zinc-800 p-5 sm:px-6">
        <h2>Run history</h2>
        <p className="mt-2 text-xs text-muted">
          Latest 50 runs. Logs remain available after a job exits.
        </p>
      </div>
      {cancel.error && (
        <p
          role="alert"
          className="error-notice m-5 [border:1px_solid_#4d2b2d] [background:light-dark(#f4f4f5,_#231719)] [border-radius:7px] [padding:18px] [font-size:12px] [color:#ffb4ae] [line-height:1.8] [overflow-wrap:anywhere] [&_p]:[margin-top:5px]"
        >
          {cancel.error.message}
        </p>
      )}
      {!jobs.data.runs.length && <p className="p-6 text-sm text-muted">No jobs have run yet.</p>}
      <div className="divide-y divide-zinc-800">
        {jobs.data.runs.map((run) => (
          <JobRunRow key={run.id} run={run} cancel={cancel} service={service} />
        ))}
      </div>
    </section>
  )
}
