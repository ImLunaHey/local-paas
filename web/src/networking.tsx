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
      <section className="panel p-6">
        <h2>Background worker</h2>
        <p className="text-sm text-muted mt-3">
          This process has no inbound HTTP endpoint. Use private service connections, database
          connections and storage bindings for its dependencies.
        </p>
      </section>
    )
  if (network.error)
    return (
      <p role="alert" className="error-notice">
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
    <section className="panel p-6 space-y-5" aria-label="Service networking">
      <div className="section-heading">
        <div>
          <h2>Networking</h2>
          <p className="text-xs text-muted mt-2">
            Give this app a private link, accessible from your Tailscale network.
          </p>
        </div>
        <span className="chip">Tailnet only</span>
      </div>
      {network.authority && (
        <div className="revision-row flex flex-wrap gap-4 justify-between items-center">
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
            className="button primary"
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
        <p role="alert" className="error-notice">
          {save.error.message}
        </p>
      )}
      {save.isSuccess && <p role="status">Networking saved.</p>}
      {network.activePort !== null && desiredPort !== network.activePort && (
        <p role="status" className="error-notice">
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
