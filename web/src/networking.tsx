import { Button, Input, Select, Field } from './ui'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink } from 'lucide-react'
import { api, type Service } from './api'
interface Network {
  authority: string | null
  available: string[]
  active_port: number | null
  scope: string
}
export function Networking({ service }: { service: Service }) {
  const network = useQuery({
    queryKey: ['networking', service.id],
    queryFn: () => api<Network>('/services/' + service.id + '/networking'),
  })
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
    service.spec.workload.kind === 'oci-service' ? service.spec.workload.port : 3000
  const [port, setPort] = useState(desiredPort)
  const [authority, setAuthority] = useState(network.authority ?? '')
  const save = useMutation({
    mutationFn: () =>
      api('/services/' + service.id + '/networking', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          authority: authority || null,
          port,
          expected_version: service.version,
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
            Private HTTPS URL → ready instances → container port
          </p>
        </div>
        <span className="chip">Tailnet only</span>
      </div>
      {network.authority && (
        <div className="revision-row flex flex-wrap gap-4 justify-between items-center">
          <div>
            <code className="break-all">https://{network.authority}</code>
            <p className="text-xs text-muted mt-2">
              Active container port: {network.active_port ?? 'Not deployed'} · configured port:{' '}
              {desiredPort}
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
        <Field label="Container port">
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
        <Field label="HTTPS endpoint">
          <Select
            aria-label="HTTPS endpoint"
            value={authority}
            onChange={(e) => setAuthority(e.target.value)}
          >
            <option value="">No URL mapping</option>
            {[
              ...new Set([...(network.authority ? [network.authority] : []), ...network.available]),
            ].map((a) => (
              <option key={a} value={a}>
                {'https://' + a}
              </option>
            ))}
          </Select>
        </Field>
        <div className="flex gap-3 items-center sm:col-span-2">
          <Button variant="primary" disabled={save.isPending} type="submit">
            Save networking
          </Button>
          {!authority && network.available.length > 0 && (
            <Button
              type="button"
              className="button"
              onClick={() => setAuthority(network.available[0])}
            >
              Choose available URL
            </Button>
          )}
        </div>
      </form>
      {save.error && (
        <p role="alert" className="error-notice">
          {save.error.message}
        </p>
      )}
      {save.isSuccess && <p role="status">Networking saved.</p>}
      {network.active_port !== null && desiredPort !== network.active_port && (
        <p role="status" className="error-notice">
          Port change pending: deploy a new revision to switch from port {network.active_port} to{' '}
          {desiredPort}.
        </p>
      )}
      <p className="text-xs text-muted">
        URL changes take effect immediately. A container port change applies on the next deployment;
        the current healthy deployment keeps its original port. The app must listen on 0.0.0.0 and
        the configured port.
      </p>
      <p className="text-xs text-muted">
        These endpoints have TLS configured through Tailscale Serve. Custom public domains require
        the planned public edge and DNS setup; entering a domain in service configuration does not
        provision public ingress.
      </p>
    </section>
  )
}
