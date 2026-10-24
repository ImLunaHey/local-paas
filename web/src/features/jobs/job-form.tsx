import { JobFields } from './job-fields'

import type { Options, Schedule, Draft } from './job-types'

import { useRef, useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { Clock3, Play } from 'lucide-react'

import { api } from '../../api-client'
import type { Service } from '../../generated/model/service'
import { type Revision } from '../../api'
import { Button } from '../../components/button'
import { Field } from '../../components/field'
import { Input } from '../../components/input'

export function JobForm({
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
