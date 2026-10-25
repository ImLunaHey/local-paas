import { DomainAssignment } from './domain-assignment'

import type { DomainList } from '../../generated/model/domainList'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Globe, Plus } from 'lucide-react'
import { api } from '../../api-client'

import { Button } from '../../components/button'
import { Field } from '../../components/field'
import { Input } from '../../components/input'

export function Domains() {
  const client = useQueryClient()
  const query = useQuery({
    queryKey: ['domains'],
    queryFn: () => api<DomainList>('/domains'),
    refetchInterval: 5000,
  })
  const [hostname, setHostname] = useState('')
  const create = useMutation({
    mutationFn: () =>
      api('/domains', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hostname }),
      }),
    onSuccess: async () => {
      setHostname('')
      await client.invalidateQueries({ queryKey: ['domains'] })
    },
  })
  return (
    <>
      <div className="page-heading [display:flex] [justify-content:space-between] [align-items:center] [gap:24px] [margin-bottom:30px] [&_p]:[color:light-dark(#52525b,_#a0a0a8)] [&_p]:[font-size:12px] [&_p]:[margin-top:12px] max-[720px]:[align-items:start] max-[720px]:[flex-direction:column] max-[720px]:[gap:20px]">
        <div>
          <div className="eyebrow [font-size:9px] [letter-spacing:1.7px] [color:light-dark(#52525b,_#8d8d95)] [font-weight:600] [text-transform:uppercase] [margin-bottom:13px]">
            WORKSPACE NETWORKING
          </div>
          <h1>Domains</h1>
          <p>Register a domain once. Assign it to any project’s web service.</p>
        </div>
        <Globe size={24} className="text-accent" />
      </div>
      <section className="panel mb-6 space-y-4 p-5 [background:light-dark(#f4f4f5,_#131315)] [border:1px_solid_light-dark(#e4e4e7,_#28282c)] [border-radius:8px] [box-shadow:0_1px_0_#ffffff04_inset,_0_8px_24px_#0000000d]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2>Public edge</h2>
        </div>
        <p className="text-xs leading-relaxed text-muted">
          Each domain reports its observed DNS, TLS, and route status. Public deployments wait for
          the edge to acknowledge a healthy route before the previous revision is retired.
        </p>
        {query.data?.cnameTarget ? (
          <div className="rounded-md border border-zinc-800 bg-zinc-950 p-4">
            <span className="text-[10px] uppercase tracking-wider text-muted">CNAME target</span>
            <code className="mt-2 block break-all text-sm">{query.data.cnameTarget}</code>
            <p className="mt-2 text-xs text-muted">
              Point subdomains here at your DNS provider. For a root domain, use ALIAS/ANAME or
              CNAME flattening if your provider supports it. DNS configuration alone does not prove
              that a route is active. Add the ownership TXT record shown on each domain.
            </p>
          </div>
        ) : (
          <div className="rounded-md border border-dashed border-zinc-700 p-4 text-xs text-muted">
            No CNAME target configured yet. The shared target will appear here when the public edge
            hostname is set.
          </div>
        )}
      </section>
      <form
        className="panel mb-6 grid items-end gap-3 p-5 sm:grid-cols-[1fr_auto] [background:light-dark(#f4f4f5,_#131315)] [border:1px_solid_light-dark(#e4e4e7,_#28282c)] [border-radius:8px] [box-shadow:0_1px_0_#ffffff04_inset,_0_8px_24px_#0000000d]"
        onSubmit={(e) => {
          e.preventDefault()
          create.mutate()
        }}
      >
        <Field label="Domain" className="min-w-0">
          <Input
            required
            aria-label="Domain"
            maxLength={253}
            placeholder="app.example.com"
            value={hostname}
            onChange={(e) => {
              setHostname(e.target.value)
              create.reset()
            }}
          />
        </Field>
        <Button
          type="submit"
          variant="primary"
          className="w-full sm:w-auto"
          disabled={create.isPending}
        >
          <Plus size={15} />
          Add domain
        </Button>
        <p className="text-xs text-muted sm:col-span-2">
          Enter a hostname such as app.example.com, without https://.
        </p>
      </form>
      {(query.error || create.error) && (
        <p
          role="alert"
          className="error-notice [border:1px_solid_#4d2b2d] [background:light-dark(#f4f4f5,_#231719)] [border-radius:7px] [padding:18px] [font-size:12px] [color:#ffb4ae] [line-height:1.8] [overflow-wrap:anywhere] [&_p]:[margin-top:5px]"
        >
          {(query.error || create.error)?.message}
        </p>
      )}
      <div className="space-y-4">
        {query.data?.items.map((domain) => (
          <DomainAssignment key={domain.hostname + ':' + domain.version} domain={domain} />
        ))}
      </div>
      {query.isPending && <p className="text-xs text-muted">Loading domains…</p>}
      {query.data?.items.length === 0 && (
        <div className="panel p-12 text-center [background:light-dark(#f4f4f5,_#131315)] [border:1px_solid_light-dark(#e4e4e7,_#28282c)] [border-radius:8px] [box-shadow:0_1px_0_#ffffff04_inset,_0_8px_24px_#0000000d]">
          <Globe size={24} className="mx-auto mb-4 text-muted" />
          <h2>No domains yet</h2>
          <p className="mt-2 text-xs text-muted">
            Add a domain now and choose the service it should reach.
          </p>
        </div>
      )}
    </>
  )
}
