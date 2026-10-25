import { JobSchedule } from './job-schedule'
import { JobHistory } from './job-history'
import { JobForm } from './job-form'

import { pending } from './job-status'

import { useServiceJobs } from './use-service-jobs'

import { Terminal } from 'lucide-react'

import type { Service } from '../../generated/model/service'

export function JobsPanel({ service }: { service: Service }) {
  const { supported, jobs, revisions, cancel, pause } = useServiceJobs({ service })
  if (!supported)
    return (
      <section className="panel p-6 [background:light-dark(#f4f4f5,_#131315)] [border:1px_solid_light-dark(#e4e4e7,_#28282c)] [border-radius:8px] [box-shadow:0_1px_0_#ffffff04_inset,_0_8px_24px_#0000000d]">
        <h2>Jobs</h2>
        <p className="mt-3 text-sm text-muted">
          One-off jobs use an application’s OCI image. Open an app to configure its jobs.
        </p>
      </section>
    )
  if (jobs.error || revisions.error)
    return (
      <p
        role="alert"
        className="error-notice [border:1px_solid_#4d2b2d] [background:light-dark(#f4f4f5,_#231719)] [border-radius:7px] [padding:18px] [font-size:12px] [color:#ffb4ae] [line-height:1.8] [overflow-wrap:anywhere] [&_p]:[margin-top:5px]"
      >
        {(jobs.error ?? revisions.error)?.message}
      </p>
    )
  if (!jobs.data || !revisions.data) return <p className="text-sm text-muted">Loading jobs…</p>
  const blocked = jobs.data.runs.some((r) => pending(r) || r.cleanupPending)
  const schedule = jobs.data.schedule
  return (
    <div className="space-y-6">
      <section className="panel space-y-6 p-5 sm:p-6 [background:light-dark(#f4f4f5,_#131315)] [border:1px_solid_light-dark(#e4e4e7,_#28282c)] [border-radius:8px] [box-shadow:0_1px_0_#ffffff04_inset,_0_8px_24px_#0000000d]">
        <div>
          <h2 className="flex items-center gap-2">
            <Terminal size={16} /> Run a job
          </h2>
          <p className="mt-2 text-xs leading-relaxed text-muted">
            Run an import, migration, or maintenance command alongside this app. Each run inherits
            its current secrets, connections, resource limits, and attached volume. It exposes no
            HTTP port and never restarts automatically.
          </p>
        </div>
        {!revisions.data.length ? (
          <p className="text-sm text-muted">
            Build an image in the Builds tab before running or scheduling jobs.
          </p>
        ) : (
          <JobForm
            key={service.id + ':run'}
            service={service}
            revisions={revisions.data}
            scheduled={false}
            blocked={blocked}
          />
        )}
      </section>
      <JobSchedule
        schedule={schedule}
        pause={pause}
        revisions={revisions}
        service={service}
        blocked={blocked}
        jobs={jobs}
      />
      <JobHistory jobs={jobs} cancel={cancel} service={service} />
    </div>
  )
}
