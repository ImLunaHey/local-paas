import { Button, Input, Field } from './ui'
import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type Service } from './api'
interface SecretSet {
  configured: boolean
  version: number
  names: string[]
  ownNames: string[]
  origins: Record<string, string>
  references: string[]
  path: string
}
export function SecretManager({
  service,
  onReadyChange,
}: {
  service: Service
  onReadyChange?: (ready: boolean) => void
}) {
  const client = useQueryClient()
  const form = useRef<HTMLFormElement>(null)
  const [notice, setNotice] = useState('')
  const [dirty, setDirty] = useState(false)
  const secrets = useQuery({
    queryKey: ['secrets', service.id],
    queryFn: () => api<SecretSet>('/services/' + service.id + '/secrets'),
  })
  const changed = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ['secrets', service.id] }),
      client.invalidateQueries({ queryKey: ['services', service.id] }),
    ])
    setNotice('Saved. Deploy a revision to apply the new secret version.')
    setDirty(false)
  }
  // Never place secret values in React state, mutation variables or Query/devtools caches.
  const save = useMutation({
    mutationFn: async () => {
      const data = new FormData(form.current!)
      const body = JSON.stringify({
        name: data.get('name'),
        value: data.get('value'),
        expectedVersion: secrets.data?.version,
      })
      form.current!.reset()
      return api('/services/' + service.id + '/secrets', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body,
      })
    },
    onSuccess: changed,
  })
  const remove = useMutation({
    mutationFn: (name: string) =>
      api('/services/' + service.id + '/secrets', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, value: null, expectedVersion: secrets.data?.version }),
      }),
    onSuccess: changed,
  })
  const busy = save.isPending || remove.isPending
  useEffect(() => {
    onReadyChange?.(!busy && !dirty && !save.isError && !remove.isError)
  }, [busy, dirty, save.isError, remove.isError, onReadyChange])
  return (
    <section className="panel p-6 space-y-5" aria-label="Service secrets">
      <div className="section-heading">
        <h2>Secrets</h2>
        <span className="chip">OpenBao · version {secrets.data?.version ?? '—'}</span>
      </div>
      <p className="text-xs text-muted">
        Values are stored in OpenBao and are never shown again. Each deployment uses a fixed
        version. Removing a secret applies to future deployments.
      </p>
      {(secrets.error || save.error || remove.error) && (
        <p role="alert" className="error-notice">
          {(secrets.error || save.error || remove.error)?.message}
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm">
          {notice}
        </p>
      )}
      {secrets.data && !secrets.data.configured && (
        <p role="alert" className="error-notice">
          OpenBao is not configured.
        </p>
      )}
      <form
        ref={form}
        onChange={() => setDirty(true)}
        autoComplete="off"
        className="grid sm:grid-cols-2 gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          setNotice('')
          save.mutate()
        }}
      >
        <Field label="Name">
          <Input
            name="name"
            disabled={busy}
            required
            pattern="[A-Z_][A-Z0-9_]*"
            maxLength={128}
            placeholder="DATABASE_URL"
            autoComplete="off"
          />
        </Field>
        <Field label="Value">
          <Input
            name="value"
            disabled={busy}
            type="password"
            required
            maxLength={32768}
            autoComplete="new-password"
            placeholder="New secret value"
          />
        </Field>
        <div className="flex flex-wrap gap-3 sm:col-span-2">
          <Button variant="primary" disabled={busy || !secrets.data?.configured} type="submit">
            Save secret
          </Button>
          {(dirty || save.isError) && (
            <Button
              disabled={busy}
              onClick={() => {
                form.current?.reset()
                setDirty(false)
                save.reset()
                setNotice('')
              }}
            >
              Discard unsaved secret
            </Button>
          )}
        </div>
      </form>
      <div className="space-y-2">
        {[...new Set([...(secrets.data?.names ?? []), ...(secrets.data?.references ?? [])])].map(
          (name) => (
            <div className="revision-row flex justify-between items-center gap-3" key={name}>
              <div>
                <code className="text-sm">{name}</code>
                <p className="text-xs text-muted mt-1">
                  {secrets.data?.names.includes(name)
                    ? secrets.data.origins[name] === service.id
                      ? 'Local value stored'
                      : 'Inherited from shadow source · save this name to override'
                    : 'Missing value · deployment will be blocked'}
                </p>
              </div>
              <Button
                disabled={busy || !secrets.data?.ownNames.includes(name)}
                onClick={() => remove.mutate(name)}
              >
                Remove local value
              </Button>
            </div>
          ),
        )}
        {secrets.data?.names.length === 0 && !secrets.data.references.length && (
          <p className="text-xs text-muted">No secrets yet.</p>
        )}
      </div>
    </section>
  )
}
