import { useRef, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Clock3, Play, Terminal } from 'lucide-react'
import { cn } from 'cn'
import { api, type Revision, type Service } from './api'
import { Button, Field, Input, Select, Textarea } from './ui'

interface Options {
  command: string[]
  timeoutSeconds: number
}
interface Schedule {
  version: number
  revisionId: string
  options: Options
  intervalMinutes: number
  status: 'enabled' | 'paused'
  nextRunAt: string
}
interface Run {
  id: string
  revisionId: string
  options: Options
  status: string
  result: { outcome: string; exitCode: number | null } | null
  createdAt: string
  completedAt: string | null
  instanceId: string | null
  node: string | null
  cleanupPending: boolean
  errorCode: string | null
}
interface Jobs {
  runs: Run[]
  schedule: Schedule | null
  occurrences: {
    id: string
    scheduledAt: string
    status: string
    skippedCount: number
  }[]
}
interface Draft {
  revision: string
  executable: string
  arguments: string
  timeout: number
}
const pending = (run: Run) => ['queued', 'assigned', 'running', 'unknown'].includes(run.status)
const labels: Record<string, string> = {
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
const initial = (revisions: Revision[], schedule?: Schedule | null): Draft => ({
  revision: schedule?.revisionId ?? revisions[0]?.id ?? '',
  executable: schedule?.options.command[0] ?? '',
  arguments: schedule?.options.command.slice(1).join('\n') ?? '',
  timeout: schedule?.options.timeoutSeconds ?? 300,
})
const options = (draft: Draft): Options => ({
  command: draft.executable
    ? [draft.executable, ...(draft.arguments ? draft.arguments.split('\n') : [])]
    : [],
  timeoutSeconds: draft.timeout,
})

function JobFields({
  draft,
  setDraft,
  revisions,
}: {
  draft: Draft
  setDraft: (draft: Draft) => void
  revisions: Revision[]
}) {
  return (
    <div className="grid min-w-0 gap-5 sm:grid-cols-2">
      <Field
        label="Image revision"
        hint="Pinned to this immutable image, even after another build."
      >
        <Select
          required
          value={draft.revision}
          onChange={(e) => setDraft({ ...draft, revision: e.target.value })}
        >
          {!draft.revision && <option value="">Build an image first</option>}
          {draft.revision && !revisions.some((r) => r.id === draft.revision) && (
            <option value={draft.revision}>{draft.revision.slice(0, 8)} · retained revision</option>
          )}
          {revisions.map((r) => (
            <option key={r.id} value={r.id}>
              {r.id.slice(0, 8)} · {new Date(r.createdAt).toLocaleString()}
            </option>
          ))}
        </Select>
      </Field>
      <Field
        label="Time limit (seconds)"
        hint="10 seconds to 24 hours, including image preparation after assignment."
      >
        <Input
          required
          type="number"
          min={10}
          max={86400}
          value={draft.timeout}
          onChange={(e) => setDraft({ ...draft, timeout: Number(e.target.value) })}
        />
      </Field>
      <Field
        label="Executable"
        hint="Leave empty to use the image’s default command. Overrides its entrypoint and command."
        className="sm:col-span-2"
      >
        <Input
          maxLength={4096}
          placeholder="e.g. /app/import_wikidata"
          value={draft.executable}
          onChange={(e) => setDraft({ ...draft, executable: e.target.value })}
        />
      </Field>
      {draft.executable && (
        <Field
          label="Arguments"
          hint="One argument per line, without shell quoting. Use the Secrets tab for credentials; command text is saved in run history."
          className="sm:col-span-2"
        >
          <Textarea
            maxLength={16384}
            placeholder={'--limit\n100'}
            value={draft.arguments}
            onChange={(e) => setDraft({ ...draft, arguments: e.target.value })}
          />
        </Field>
      )}
    </div>
  )
}

function JobForm({
  service,
  revisions,
  schedule,
  scheduled,
  blocked,
}: {
  service: Service
  revisions: Revision[]
  schedule?: Schedule | null
  scheduled: boolean
  blocked: boolean
}) {
  const client = useQueryClient()
  const [draft, setDraft] = useState(() => initial(revisions, schedule))
  const [minutes, setMinutes] = useState(schedule?.intervalMinutes ?? 60)
  const [enabled, setEnabled] = useState(schedule?.status !== 'paused')
  const [saved, setSaved] = useState(false)
  const operation = useRef<{ input: string; id: string } | null>(null)
  const mutation = useMutation({
    mutationFn: () => {
      const body = {
        revisionId: draft.revision,
        options: options(draft),
        ...(scheduled
          ? { version: schedule?.version ?? 0, intervalMinutes: minutes, enabled }
          : {}),
      }
      const input = JSON.stringify(body)
      if (operation.current?.input !== input) operation.current = { input, id: crypto.randomUUID() }
      return api(`/services/${service.id}/${scheduled ? 'job-schedule' : 'jobs'}`, {
        method: scheduled ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, operationId: operation.current.id }),
      })
    },
    onSuccess: async () => {
      operation.current = null
      setSaved(true)
      await client.invalidateQueries({ queryKey: ['jobs', service.id] })
    },
  })
  function submit(event: FormEvent) {
    event.preventDefault()
    setSaved(false)
    mutation.mutate()
  }
  return (
    <form
      onSubmit={submit}
      className="space-y-5"
      aria-label={scheduled ? 'Job schedule' : 'Run a job'}
    >
      <JobFields draft={draft} setDraft={setDraft} revisions={revisions} />
      {scheduled && (
        <div className="grid items-start gap-5 sm:grid-cols-2">
          <Field
            label="Repeat every (minutes)"
            hint="1 minute to 1 week. Saving restarts the interval from now."
          >
            <Input
              required
              type="number"
              min={1}
              max={10080}
              value={minutes}
              onChange={(e) => setMinutes(Number(e.target.value))}
            />
          </Field>
          <label className="flex min-h-11 items-center gap-3 text-xs text-zinc-300 sm:mt-6">
            <Input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            Schedule enabled
          </label>
        </div>
      )}
      {mutation.error && (
        <p role="alert" className="error-notice">
          {mutation.error.message}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="submit"
          variant="primary"
          disabled={!draft.revision || mutation.isPending || (!scheduled && blocked)}
        >
          {scheduled ? <Clock3 size={14} /> : <Play size={14} />}
          {mutation.isPending ? 'Saving…' : scheduled ? 'Save schedule' : 'Run now'}
        </Button>
        {saved && (
          <span role="status" className="text-xs text-emerald-300">
            {scheduled ? 'Schedule saved' : 'Job queued'}
          </span>
        )}
        {!scheduled && blocked && (
          <span className="text-xs text-muted">
            Waiting for the previous job to finish and release its allocation.
          </span>
        )}
      </div>
    </form>
  )
}

export function JobsPanel({ service }: { service: Service }) {
  const client = useQueryClient()
  const supported = service.spec.workload.kind === 'oci-service'
  const jobs = useQuery({
    queryKey: ['jobs', service.id],
    queryFn: () => api<Jobs>(`/services/${service.id}/jobs`),
    enabled: supported,
    refetchInterval: 3000,
  })
  const revisions = useQuery({
    queryKey: ['revisions', service.id],
    queryFn: () => api<Revision[]>(`/services/${service.id}/revisions`),
    enabled: supported,
    refetchInterval: 5000,
  })
  const cancel = useMutation({
    mutationFn: (id: string) => api(`/deployments/${id}/stop`, { method: 'POST' }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['jobs', service.id] }),
  })
  const pause = useMutation({
    mutationFn: () => {
      const schedule = jobs.data!.schedule!
      return api(`/services/${service.id}/job-schedule`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operationId: crypto.randomUUID(),
          version: schedule.version,
          revisionId: schedule.revisionId,
          options: schedule.options,
          intervalMinutes: schedule.intervalMinutes,
          enabled: false,
        }),
      })
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ['jobs', service.id] }),
  })
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
      <section className="panel overflow-hidden" aria-label="Job run history">
        <div className="border-b border-zinc-800 p-5 sm:px-6">
          <h2>Run history</h2>
          <p className="mt-2 text-xs text-muted">
            Latest 50 runs. Logs remain available after a job exits.
          </p>
        </div>
        {cancel.error && (
          <p role="alert" className="error-notice m-5">
            {cancel.error.message}
          </p>
        )}
        {!jobs.data.runs.length && <p className="p-6 text-sm text-muted">No jobs have run yet.</p>}
        <div className="divide-y divide-zinc-800">
          {jobs.data.runs.map((run) => (
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
                <time className="text-xs text-muted">
                  {new Date(run.createdAt).toLocaleString()}
                </time>
              </div>
              <p className="break-all font-mono text-xs text-zinc-300">
                {run.options.command.length
                  ? run.options.command.join(' ')
                  : 'Image default command'}
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
                  The node could not prove the outcome. Check logs and external effects before
                  starting another run.
                </p>
              )}
              {run.errorCode === 'job_setup_failed' && (
                <p className="text-xs text-red-300">
                  Job setup failed. Review the instance logs and secret availability.
                </p>
              )}
              {run.result?.outcome === 'failed' && run.result.exitCode == null && (
                <p className="text-xs text-red-300">
                  The job could not be prepared. Check image availability, attached storage, and
                  credentials before retrying.
                </p>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
