import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { api } from './api'
import { Button, Field, Input, Select } from './ui'
interface Domain {
  hostname: string
  service_id: string | null
  service: string | null
}
export function ServiceDomains({
  serviceId,
  onChange,
  onReadyChange,
}: {
  serviceId?: string
  onChange: () => void
  onReadyChange: (ready: boolean) => void
}) {
  const query = useQuery({
    queryKey: ['domains'],
    queryFn: () => api<{ items: Domain[] }>('/domains'),
  })
  const [selection, setSelection] = useState<string[]>()
  useEffect(() => onReadyChange(query.isSuccess), [query.isSuccess, onReadyChange])
  const selected =
    selection ??
    query.data?.items.filter((d) => d.service_id === serviceId).map((d) => d.hostname) ??
    []
  return (
    <div className="space-y-3">
      <Field
        label="Domains"
        hint="Choose a registered domain. Public routing is pending VPS and NetBird setup."
      >
        <Select
          disabled={!query.data}
          value=""
          onChange={(e) => {
            if (e.target.value) {
              setSelection([...selected, e.target.value])
              onChange()
            }
          }}
        >
          <option value="">
            {query.isPending ? 'Loading domains…' : 'Select a domain (optional)'}
          </option>
          {query.data?.items
            .filter((d) => !selected.includes(d.hostname))
            .map((d) => (
              <option
                key={d.hostname}
                value={d.hostname}
                disabled={!!d.service_id && d.service_id !== serviceId}
              >
                {d.hostname}
                {d.service_id && d.service_id !== serviceId ? ` · assigned to ${d.service}` : ''}
              </option>
            ))}
        </Select>
      </Field>
      {selected.map((name) => (
        <div
          key={name}
          className="flex items-center justify-between gap-3 rounded-md border border-zinc-800 px-3 py-2 text-xs"
        >
          <Input type="hidden" name="domains" value={name} />
          <span className="break-all">{name}</span>
          <Button
            variant="ghost"
            aria-label={`Remove ${name}`}
            onClick={() => {
              setSelection(selected.filter((n) => n !== name))
              onChange()
            }}
          >
            Remove
          </Button>
        </div>
      ))}
      {query.error && (
        <p role="alert" className="error-notice">
          Could not load domains. {query.error.message}
        </p>
      )}
      <Link to="/domains" className="text-xs text-accent">
        Manage registered domains ↗
      </Link>
    </div>
  )
}
