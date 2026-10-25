import { useQueryClient } from '@tanstack/react-query'
import { ExternalLink } from 'lucide-react'
import type { FormEvent } from 'react'
import { Button } from '../../components/button'
import { Field } from '../../components/field'
import { Input } from '../../components/input'
import { Status } from '../../components/status'
import type { ApiRequestError } from '../../api-client'
import type { PreviewPolicy } from '../../generated/model/previewPolicy'
import {
  getGetPreviewPolicyQueryKey,
  getListPreviewsQueryKey,
  useGetPreviewPolicy,
  useConfigurePreviewPolicy,
  useListPreviews,
  useDeletePreview,
} from '../../generated/management'

export function PrPreviews({ connectionId }: { connectionId: string }) {
  const client = useQueryClient()
  const policy = useGetPreviewPolicy(connectionId)
  const previews = useListPreviews(connectionId, { query: { refetchInterval: 5000 } })
  const save = useConfigurePreviewPolicy<ApiRequestError>({
    mutation: {
      onSuccess: async () => {
        await client.invalidateQueries({ queryKey: getGetPreviewPolicyQueryKey(connectionId) })
        await client.invalidateQueries({ queryKey: getListPreviewsQueryKey(connectionId) })
      },
    },
  })
  const remove = useDeletePreview<ApiRequestError>({
    mutation: {
      onSuccess: async () => {
        await client.invalidateQueries({ queryKey: getListPreviewsQueryKey(connectionId) })
      },
    },
  })
  return (
    <section className="space-y-4 border-t border-zinc-800 pt-5" aria-label="Pull request previews">
      <div>
        <h3 className="text-sm font-medium">Pull request previews</h3>
        <p className="mt-2 max-w-2xl text-xs text-muted">
          Automatically build and deploy same-repository pull requests to private URLs. Each preview
          runs one HTTP replica with its own environment. Production secrets, variables, volumes,
          dependencies, build arguments and pre-deploy commands are excluded. Forks are denied.
        </p>
      </div>
      {policy.isPending ? (
        <p className="text-xs text-muted">Loading preview policy…</p>
      ) : policy.error ? (
        <p role="alert" className="error-notice">
          Preview policy is unavailable.
        </p>
      ) : (
        <PreviewPolicyForm
          key={JSON.stringify(policy.data)}
          policy={policy.data ?? undefined}
          pending={save.isPending}
          onSave={(data) => save.mutate({ id: connectionId, data })}
        />
      )}
      {save.error && (
        <p role="alert" className="error-notice">
          {save.error.message}
        </p>
      )}
      {save.isSuccess && (
        <p role="status" className="text-xs text-muted">
          Preview policy saved.
        </p>
      )}
      {previews.isPending ? (
        <p className="text-xs text-muted">Loading previews…</p>
      ) : previews.error ? (
        <p role="alert" className="error-notice">
          Previews are unavailable.
        </p>
      ) : previews.data?.length ? (
        <ul className="space-y-3">
          {previews.data.map((preview) => (
            <li
              key={preview.id}
              className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-zinc-800 p-4"
            >
              <div className="min-w-0 space-y-2">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-xs font-medium">PR #{preview.number}</span>
                  <Status
                    value={preview.status}
                    tone={
                      preview.status === 'ready'
                        ? 'healthy'
                        : ['failed', 'blocked', 'degraded'].includes(preview.status)
                          ? 'error'
                          : 'neutral'
                    }
                  />
                  <code className="text-xs text-muted">{preview.headCommit.slice(0, 12)}</code>
                </div>
                <p className="max-w-xl text-xs text-muted">{preview.reason}</p>
                <p className="text-xs text-muted">
                  Expires {new Date(preview.expiresAt).toLocaleString()}
                </p>
                {preview.previewUrl && (
                  <a
                    className="inline-flex min-h-9 items-center gap-2 text-xs text-zinc-200 underline"
                    href={preview.previewUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open private preview <ExternalLink size={12} />
                  </a>
                )}
              </div>
              {!['closed', 'cleaning'].includes(preview.status) && (
                <Button
                  variant="secondary"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate({ id: connectionId, previewId: preview.id })}
                  aria-label={`Clean up PR ${preview.number}`}
                >
                  Clean up
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted">
          No PR previews yet. Enable the policy and send an opened, reopened or synchronize webhook.
        </p>
      )}
      {remove.error && (
        <p role="alert" className="error-notice">
          {remove.error.message}
        </p>
      )}
    </section>
  )
}

function PreviewPolicyForm({
  policy,
  pending,
  onSave,
}: {
  policy?: PreviewPolicy
  pending: boolean
  onSave: (policy: PreviewPolicy) => void
}) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    onSave({
      enabled: data.get('enabled') === 'on',
      maxActive: Number(data.get('maxActive')),
      maxBuilds: Number(data.get('maxBuilds')),
      ttlHours: Number(data.get('ttlHours')),
      resources: {
        cpuMillis: Number(data.get('cpuMillis')),
        memoryMib: Number(data.get('memoryMib')),
      },
    })
  }
  return (
    <form onSubmit={submit} className="grid max-w-2xl gap-4">
      <label className="flex min-h-9 items-center gap-3 text-xs">
        <Input type="checkbox" name="enabled" defaultChecked={policy?.enabled ?? false} />
        Enable automatic PR previews
      </label>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Maximum active previews">
          <Input
            type="number"
            name="maxActive"
            min={1}
            max={10}
            required
            defaultValue={policy?.maxActive ?? 3}
          />
        </Field>
        <Field label="Concurrent preview builds">
          <Input
            type="number"
            name="maxBuilds"
            min={1}
            max={3}
            required
            defaultValue={policy?.maxBuilds ?? 1}
          />
        </Field>
        <Field label="Expiry after update (hours)">
          <Input
            type="number"
            name="ttlHours"
            min={1}
            max={168}
            required
            defaultValue={policy?.ttlHours ?? 24}
          />
        </Field>
        <Field label="CPU per preview (millicores)">
          <Input
            type="number"
            name="cpuMillis"
            min={100}
            max={2000}
            required
            defaultValue={policy?.resources.cpuMillis ?? 250}
          />
        </Field>
        <Field label="Memory per preview (MiB)">
          <Input
            type="number"
            name="memoryMib"
            min={64}
            max={2048}
            required
            defaultValue={policy?.resources.memoryMib ?? 256}
          />
        </Field>
      </div>
      <p className="text-xs text-muted">
        Disabling previews requests cleanup of existing previews. Resource and build settings apply
        to new previews. Closing, merging or expiry removes routes and waits for confirmed shutdown;
        history remains available. Cleanup or expiry requires a newer PR reopen event to start
        again.
      </p>
      <div>
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? 'Saving…' : 'Save preview policy'}
        </Button>
      </div>
    </form>
  )
}
