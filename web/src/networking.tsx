import { PrivateNetworking } from './private-networking'
import { Button } from './components/button'
import { Input } from './components/input'
import { Field } from './components/field'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink } from 'lucide-react'
import { api } from './api-client'
import type { Service } from './generated/model/service'
interface Network {
  authority: string | null
  available: string[]
  activePort: number | null
  scope: string
}
export function Networking({ service }: { service: Service }) {
  return (
    <div className="space-y-6">
      <PublicNetworking service={service} />
      {service.spec.workload.kind === 'oci-service' && (
        <PrivateNetworking key={service.version} service={service} />
      )}
    </div>
  )
}
function PublicNetworking({ service }: { service: Service }) {
  const network = useQuery({
    queryKey: ['networking', service.id],
    queryFn: () => api<Network>('/services/' + service.id + '/networking'),
  })
  if (service.spec.workload.kind === 'oci-service' && service.spec.workload.execution === 'worker')
    return (
      <section className="panel p-6 [background:light-dark(#f4f4f5,_#131315)] [border:1px_solid_light-dark(#e4e4e7,_#28282c)] [border-radius:8px] [box-shadow:0_1px_0_#ffffff04_inset,_0_8px_24px_#0000000d]">
        <h2>Background worker</h2>
        <p className="text-sm text-muted mt-3">
          This process has no inbound HTTP endpoint. Use private service connections, database
          connections and storage bindings for its dependencies.
        </p>
      </section>
    )
  if (network.error)
    return (
      <p
        role="alert"
        className="error-notice [border:1px_solid_#4d2b2d] [background:light-dark(#f4f4f5,_#231719)] [border-radius:7px] [padding:18px] [font-size:12px] [color:#ffb4ae] [line-height:1.8] [overflow-wrap:anywhere] [&_p]:[margin-top:5px]"
      >
        {network.error.message}
      </p>
    )
  if (!network.data) return <p className="text-muted">Loading networking…</p>
  if (service.spec.workload.kind !== 'oci-service')
    return (
      <p className="text-muted">Networking for dedicated celld fleets is not implemented yet.</p>
    )
  return (
    <NetworkForm
      key={service.version + ':' + network.data.authority}
      service={service}
      network={network.data}
    />
  )
}
function NetworkForm({ service, network }: { service: Service; network: Network }) {
  const client = useQueryClient()
  const desiredPort =
    service.spec.workload.kind === 'oci-service' ? (service.spec.workload.port ?? 3000) : 3000
  const [port, setPort] = useState(desiredPort)
  // oxlint-disable-next-line react-doctor/no-derived-useState -- Draft resets through the parent key when service version or authority changes.
  const [enabled, setEnabled] = useState(!!network.authority)
  const save = useMutation({
    mutationFn: () =>
      api('/services/' + service.id + '/networking', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled,
          port,
          expectedVersion: service.version,
        }),
      }),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['services', service.id] }),
        client.invalidateQueries({ queryKey: ['networking', service.id] }),
        client.invalidateQueries({ queryKey: ['runtime', service.id] }),
      ])
    },
  })
  return (
    <section
      className="panel p-6 space-y-5 [background:light-dark(#f4f4f5,_#131315)] [border:1px_solid_light-dark(#e4e4e7,_#28282c)] [border-radius:8px] [box-shadow:0_1px_0_#ffffff04_inset,_0_8px_24px_#0000000d]"
      aria-label="Service networking"
    >
      <div className="section-heading [display:flex] [justify-content:space-between] [align-items:center] [margin-bottom:15px] [gap:12px] max-[720px]:[&_.tiny-label]:[font-size:8px] max-[720px]:[&_.tiny-label]:[letter-spacing:0.6px]">
        <div>
          <h2>Networking</h2>
          <p className="text-xs text-muted mt-2">
            Give this app a private link, accessible from your Tailscale network.
          </p>
        </div>
        <span className="chip [&[data-state=succeeded]]:[color:#9bd2a8] [&[data-state=succeeded]]:[background:light-dark(#e4e4e7,_#18271d)] [&[data-state=succeeded]]:[border-color:#2d4a35] [&[data-state=failed]]:[color:#ffaaa1] [&[data-state=failed]]:[background:light-dark(#e4e4e7,_#2a1919)] [&[data-state=failed]]:[border-color:#4b2a2a] [&[data-state=interrupted]]:[color:#ffaaa1] [&[data-state=interrupted]]:[background:light-dark(#e4e4e7,_#2a1919)] [&[data-state=interrupted]]:[border-color:#4b2a2a] [&[data-state=running]]:[color:#ffb282] [&[data-state=running]]:[background:#2c1c12] [&[data-state=running]]:[border-color:#4e3120] [&[data-state=queued]]:[color:#ffb282] [&[data-state=queued]]:[background:#2c1c12] [&[data-state=queued]]:[border-color:#4e3120] [display:inline-flex] [align-items:center] [gap:6px] [border:1px_solid_light-dark(#d4d4d8,_#38383c)] [background:light-dark(#e4e4e7,_#1b1b1e)] [color:light-dark(#27272a,_#c3c3ca)] [font-size:10px] [padding:5px_8px] [border-radius:5px] [white-space:nowrap]">
          Tailnet only
        </span>
      </div>
      {network.authority && (
        <div className="revision-row flex flex-wrap gap-4 justify-between items-center [border:1px_solid_light-dark(#d4d4d8,_#2c2c30)] [border-radius:6px] [padding:14px] [background:light-dark(#f4f4f5,_#19191b)] [&_code]:[color:light-dark(#27272a,_#d5d5dc)]">
          <div>
            <code className="break-all">https://{network.authority}</code>
            <p className="text-xs text-muted mt-2">
              {network.activePort == null
                ? 'URL reserved · deploy the app to serve requests'
                : `HTTPS → container port ${network.activePort}`}
              {network.activePort != null &&
                desiredPort !== network.activePort &&
                ` · next deployment: port ${desiredPort}`}
            </p>
          </div>
          <a
            className="button primary [display:inline-flex] [align-items:center] [justify-content:center] [gap:8px] [font-size:11px] [font-weight:600] [line-height:1] [white-space:nowrap] [border:1px_solid_transparent] [border-radius:6px] [padding:12px_15px] [&.primary]:[background:#ff8a4c] [&.primary]:[color:#1b100a] [&.primary]:[border-color:#ff8a4c] [&.primary:hover]:[background:#ffa36c] [&.secondary]:[background:light-dark(#e4e4e7,_#1b1b1e)] [&.secondary]:[border-color:light-dark(#d4d4d8,_#38383c)] [&.secondary]:[color:light-dark(#27272a,_#e7e7eb)] [&.secondary:hover]:[background:light-dark(#e4e4e7,_#1b1b1e)]"
            href={'https://' + network.authority}
            target="_blank"
            rel="noreferrer"
          >
            Open app <ExternalLink size={14} />
          </a>
        </div>
      )}
      <form
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault()
          save.mutate()
        }}
      >
        <Field
          label="Container port"
          hint="The port your application listens on, such as 3000. This is separate from its HTTPS URL."
        >
          <Input
            aria-label="Container port"
            type="number"
            min={1}
            max={65535}
            required
            value={port}
            onChange={(e) => setPort(Number(e.target.value))}
          />
        </Field>
        <Field label="Private access" hint="We’ll assign an available HTTPS URL automatically.">
          <Button
            type="button"
            role="switch"
            aria-checked={enabled}
            aria-label="Enable private URL"
            onClick={() => setEnabled((value) => !value)}
          >
            {enabled ? 'Private URL enabled' : 'Enable private URL'}
          </Button>
        </Field>
        <div className="flex gap-3 items-center sm:col-span-2">
          <Button variant="primary" disabled={save.isPending} type="submit">
            Save networking
          </Button>
        </div>
      </form>
      {save.error && (
        <p
          role="alert"
          className="error-notice [border:1px_solid_#4d2b2d] [background:light-dark(#f4f4f5,_#231719)] [border-radius:7px] [padding:18px] [font-size:12px] [color:#ffb4ae] [line-height:1.8] [overflow-wrap:anywhere] [&_p]:[margin-top:5px]"
        >
          {save.error.message}
        </p>
      )}
      {save.isSuccess && <p role="status">Networking saved.</p>}
      {network.activePort !== null && desiredPort !== network.activePort && (
        <p
          role="status"
          className="error-notice [border:1px_solid_#4d2b2d] [background:light-dark(#f4f4f5,_#231719)] [border-radius:7px] [padding:18px] [font-size:12px] [color:#ffb4ae] [line-height:1.8] [overflow-wrap:anywhere] [&_p]:[margin-top:5px]"
        >
          Port change pending: deploy a new revision to switch from port {network.activePort} to{' '}
          {desiredPort}.
        </p>
      )}
      <p className="text-xs text-muted">
        URL changes take effect immediately. A container port change applies on the next deployment;
        the current healthy deployment keeps its original port. The app must listen on 0.0.0.0 and
        the configured port.
      </p>
      <p className="text-xs text-muted">
        This link is private, not publicly accessible. Manage public domains on the Domains page.
        The number at the end of the assigned URL is managed by the platform; you do not need to
        change your app to match it.
      </p>
    </section>
  )
}
