import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { domainsQuery } from './domains-query'
import { Button } from './components/button'
import { Field } from './components/field'
import { Input } from './components/input'
import { Select } from './components/select'
export function ServiceDomains({
  serviceId,
  onChange,
}: {
  serviceId?: string
  onChange: () => void
}) {
  const query = useQuery(domainsQuery)
  const [selection, setSelection] = useState<string[]>()
  const selected =
    selection ??
    query.data?.items.filter((d) => d.serviceId === serviceId).map((d) => d.hostname) ??
    []
  const selectedNames = new Set(selected)
  return (
    <div className="space-y-3">
      <Field
        label="Domains"
        hint="Choose a registered domain. Public routing requires verified DNS, TLS, and an acknowledged edge route."
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
            .filter((d) => !selectedNames.has(d.hostname))
            .map((d) => (
              <option
                key={d.hostname}
                value={d.hostname}
                disabled={!!d.serviceId && d.serviceId !== serviceId}
              >
                {d.hostname}
                {d.serviceId && d.serviceId !== serviceId ? ` · assigned to ${d.service}` : ''}
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
        <p
          role="alert"
          className="error-notice [border:1px_solid_#4d2b2d] [background:light-dark(#f4f4f5,_#231719)] [border-radius:7px] [padding:18px] [font-size:12px] [color:#ffb4ae] [line-height:1.8] [overflow-wrap:anywhere] [&_p]:[margin-top:5px]"
        >
          Could not load domains. {query.error.message}
        </p>
      )}
      <Link to="/domains" className="text-xs text-accent">
        Manage registered domains ↗
      </Link>
    </div>
  )
}
