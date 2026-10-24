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
      <section className="panel p-6">
        <h2>Jobs</h2>
        <p className="mt-3 text-sm text-muted">
          One-off jobs use an application’s OCI image. Open an app to configure its jobs.
        </p>
      </section>
    )
  if (jobs.error || revisions.error)
    return (
      <p role="alert" className="error-notice">
        {(jobs.error ?? revisions.error)?.message}
      </p>
    )
  if (!jobs.data || !revisions.data) return <p className="text-sm text-muted">Loading jobs…</p>
  const blocked = jobs.data.runs.some((r) => pending(r) || r.cleanupPending)
  const schedule = jobs.data.schedule
  return (
    <div className="space-y-6">
      <section className="panel space-y-6 p-5 sm:p-6">
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
