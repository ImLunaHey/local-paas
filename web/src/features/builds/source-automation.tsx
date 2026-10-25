import { useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Copy, GitBranch, Webhook } from 'lucide-react'
import {
  getListQueryKey,
  useCreate as useCreateSourceConnection,
  useDeliveries,
  useList as useSourceConnections,
} from '../../generated/management'
import type { Service } from '../../generated/model/service'
import type { SourceConnection } from '../../generated/model/sourceConnection'
import type { ApiRequestError } from '../../api-client'
import { Button } from '../../components/button'
import { Field } from '../../components/field'
import { Input } from '../../components/input'
import { Status } from '../../components/status'

const policies = [
  ['push', 'Branch pushes'],
  ['tag', 'Tag pushes'],
  ['pull_request', 'Same-repository pull requests'],
] as const

export function SourceAutomation({ service }: { service: Service }) {
  const connections = useSourceConnections()
  const connection = connections.data?.find((item) => item.serviceId === service.id)

  return (
    <section className="panel mb-7 space-y-5 p-6" aria-label="GitHub automation">
      <div>
        <h2 className="flex items-center gap-2">
          <Webhook size={17} /> GitHub automation
        </h2>
        <p className="mt-2 text-xs text-muted">
          Verify signed events and queue the exact commit without changing deployment traffic.
        </p>
      </div>
      {connections.isPending ? (
        <p className="text-xs text-muted">Loading source connections…</p>
      ) : connections.error ? (
        <p className="error-notice" role="alert">
          Source connections are unavailable.
        </p>
      ) : connection ? (
        <ConnectionDetails connection={connection} />
      ) : (
        <ConnectionForm service={service} />
      )}
    </section>
  )
}

function ConnectionDetails({ connection }: { connection: SourceConnection }) {
  const [copied, setCopied] = useState(false)
  const deliveries = useDeliveries(connection.id, { query: { refetchInterval: 10_000 } })
  const webhookPath = `/api/webhooks/github/${connection.id}`
  const copyPath = async () => {
    await navigator.clipboard.writeText(webhookPath)
    setCopied(true)
  }
  return (
    <div className="space-y-5">
      <div className="grid gap-4 rounded-lg border border-zinc-800 bg-zinc-950/30 p-4 md:grid-cols-2">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted">Repository</div>
          <div className="mt-2 flex items-center gap-2 text-xs">
            <GitBranch size={14} /> {connection.repository}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted">Webhook path</div>
          <div className="mt-2 flex min-w-0 items-center gap-2">
            <code className="min-w-0 flex-1 truncate text-xs text-zinc-300">{webhookPath}</code>
            <Button
              variant="ghost"
              className="min-h-9 px-2"
              aria-label="Copy webhook path"
              onClick={() => void copyPath()}
            >
              <Copy size={14} /> {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
        </div>
      </div>
      <div>
        <h3 className="text-xs font-medium text-zinc-200">Recent deliveries</h3>
        {deliveries.isPending ? (
          <p className="mt-3 text-xs text-muted">Loading deliveries…</p>
        ) : deliveries.data?.length ? (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-[10px] uppercase tracking-wider text-muted">
                <tr>
                  <th className="pb-2 pr-4 font-medium">Event</th>
                  <th className="pb-2 pr-4 font-medium">Result</th>
                  <th className="pb-2 pr-4 font-medium">Commit</th>
                  <th className="pb-2 font-medium">Reason</th>
                </tr>
              </thead>
              <tbody>
                {deliveries.data.slice(0, 10).map((delivery) => (
                  <tr key={delivery.id} className="border-t border-zinc-800 align-top">
                    <td className="py-3 pr-4">{delivery.event}</td>
                    <td className="py-3 pr-4">
                      <Status
                        value={delivery.status}
                        tone={
                          delivery.status === 'accepted'
                            ? 'healthy'
                            : delivery.status === 'blocked'
                              ? 'error'
                              : 'neutral'
                        }
                      />
                    </td>
                    <td className="py-3 pr-4 font-mono text-[11px] text-zinc-400">
                      {delivery.resolvedCommit?.slice(0, 12) ?? '—'}
                    </td>
                    <td className="py-3 text-zinc-400">{delivery.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-3 text-xs text-muted">No signed deliveries received yet.</p>
        )}
      </div>
    </div>
  )
}

function ConnectionForm({ service }: { service: Service }) {
  const client = useQueryClient()
  const [secret, setSecret] = useState('')
  const [events, setEvents] = useState<string[]>(['push'])
  const create = useCreateSourceConnection<ApiRequestError>({
    mutation: {
      onSuccess: async () => {
        setSecret('')
        await client.invalidateQueries({ queryKey: getListQueryKey() })
      },
    },
  })
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const repository = String(data.get('repository') ?? '')
    create.mutate({
      data: { serviceId: service.id, repository, webhookSecret: secret, events },
    })
  }
  const toggleEvent = (name: string, checked: boolean) => {
    setEvents((current) =>
      checked ? [...new Set([...current, name])] : current.filter((item) => item !== name),
    )
  }
  const generateSecret = () => {
    const bytes = crypto.getRandomValues(new Uint8Array(32))
    setSecret(Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(''))
  }
  return (
    <form className="grid max-w-2xl gap-5" onSubmit={submit}>
      <Field
        label="GitHub repository"
        hint="Must match this service’s credential-free HTTPS source."
      >
        <Input
          name="repository"
          defaultValue={service.spec.source?.repository ?? ''}
          placeholder="owner/repository"
          required
        />
      </Field>
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
        <Field
          label="Webhook secret"
          hint="Copy this into GitHub before creating the connection. It cannot be retrieved later."
        >
          <Input
            type="password"
            autoComplete="new-password"
            value={secret}
            onChange={(event) => setSecret(event.target.value)}
            minLength={32}
            maxLength={512}
            required
          />
        </Field>
        <Button className="sm:mt-6" onClick={generateSecret}>
          Generate
        </Button>
      </div>
      <fieldset className="space-y-3">
        <legend className="text-xs text-zinc-300">Build events</legend>
        {policies.map(([name, label]) => (
          <label key={name} className="flex min-h-9 items-center gap-3 text-xs text-zinc-300">
            <Input
              type="checkbox"
              checked={events.includes(name)}
              onChange={(event) => toggleEvent(name, event.target.checked)}
            />
            {label}
          </label>
        ))}
      </fieldset>
      {create.error && (
        <p className="error-notice" role="alert">
          {create.error.message}
        </p>
      )}
      <div>
        <Button variant="primary" type="submit" disabled={create.isPending || !events.length}>
          {create.isPending ? 'Creating…' : 'Create source connection'}
        </Button>
      </div>
    </form>
  )
}
