import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Button } from './components/button'
import { Field } from './components/field'
import { Input } from './components/input'
import { Select } from './components/select'
import { api } from './api-client'
import type { Service } from './generated/model/service'
interface Target {
  id: string
  name: string
  readyInstances: number
}
export function PrivateNetworking({ service }: { service: Service }) {
  const initial =
    service.spec.workload.kind === 'oci-service'
      ? (service.spec.workload.privateConnections ?? [])
      : []
  const [connections, setConnections] = useState(() =>
    initial.map((connection) => ({ ...connection, rowId: crypto.randomUUID() })),
  )
  const configuration = connections.map(({ serviceId, env }) => ({ serviceId, env }))
  const client = useQueryClient()
  const operation = useRef<{ value: string; id: string } | null>(null)
  const targets = useQuery({
    queryKey: ['private-network', service.id],
    queryFn: () => api<{ items: Target[] }>(`/services/${service.id}/private-network`),
    refetchInterval: 5000,
  })
  const save = useMutation({
    mutationFn: async () => {
      if (service.spec.workload.kind !== 'oci-service') return
      const spec = {
        ...service.spec,
        workload: { ...service.spec.workload, privateConnections: configuration },
      }
      const value = JSON.stringify(spec)
      if (operation.current?.value !== value) operation.current = { value, id: crypto.randomUUID() }
      return api(`/services/${service.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operationId: operation.current.id,
          expectedVersion: service.version,
          spec,
        }),
      })
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['services', service.id] })
    },
  })
  return (
    <section
      className="panel p-6 space-y-5 [background:light-dark(#f4f4f5,_#131315)] [border:1px_solid_light-dark(#e4e4e7,_#28282c)] [border-radius:8px] [box-shadow:0_1px_0_#ffffff04_inset,_0_8px_24px_#0000000d]"
      aria-label="Private service connections"
    >
      <div>
        <h2>Private service connections</h2>
        <p className="text-xs text-muted mt-2">
          Connect to an app or API in {service.spec.project} / {service.spec.environment}. The
          platform injects a private HTTP URL and follows healthy instances across deployments. No
          public domain is needed.
        </p>
      </div>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          save.mutate()
        }}
      >
        {connections.map((connection, index) => {
          const target = targets.data?.items.find((t) => t.id === connection.serviceId)
          return (
            <div key={connection.rowId} className="rounded-md border border-zinc-800 p-4 space-y-3">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={`Destination service ${index + 1}`}>
                  <Select
                    required
                    value={connection.serviceId}
                    onChange={(e) =>
                      setConnections((rows) =>
                        rows.map((r, i) => (i === index ? { ...r, serviceId: e.target.value } : r)),
                      )
                    }
                  >
                    <option value="">Choose a service</option>
                    {connection.serviceId && !target && (
                      <option value={connection.serviceId}>
                        Unavailable destination · {connection.serviceId.slice(0, 8)}
                      </option>
                    )}
                    {targets.data?.items.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} · {t.readyInstances} ready
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field
                  label={`URL variable ${index + 1}`}
                  hint="Read this environment variable in your app."
                >
                  <Input
                    required
                    value={connection.env}
                    placeholder="API_URL"
                    pattern="[A-Z_][A-Z0-9_]*"
                    maxLength={128}
                    onChange={(e) =>
                      setConnections((rows) =>
                        rows.map((r, i) => (i === index ? { ...r, env: e.target.value } : r)),
                      )
                    }
                  />
                </Field>
              </div>
              {connection.serviceId && (
                <code className="block text-[11px] text-muted break-all">
                  http://svc-{connection.serviceId.replaceAll('-', '')}.internal:{24000 + index}
                </code>
              )}
              <div className="flex flex-wrap items-center gap-3">
                {target && (
                  <Link
                    className="text-xs text-orange-300 hover:underline"
                    to="/services/$serviceId"
                    params={{ serviceId: target.id }}
                  >
                    Open {target.name}
                  </Link>
                )}
                <Button
                  variant="ghost"
                  onClick={() => setConnections((rows) => rows.filter((_, i) => i !== index))}
                >
                  Remove connection {index + 1}
                </Button>
              </div>
            </div>
          )
        })}
        {!connections.length && (
          <p className="text-sm text-muted">No private service connections configured.</p>
        )}
        <div className="flex flex-wrap gap-3">
          <Button
            disabled={connections.length >= 16}
            onClick={() =>
              setConnections((rows) => [
                ...rows,
                { rowId: crypto.randomUUID(), serviceId: '', env: '' },
              ])
            }
          >
            Add connection
          </Button>
          <Button
            variant="primary"
            type="submit"
            disabled={save.isPending || JSON.stringify(initial) === JSON.stringify(configuration)}
          >
            Save connections
          </Button>
        </div>
      </form>
      {(targets.error || save.error) && (
        <p
          role="alert"
          className="error-notice [border:1px_solid_#4d2b2d] [background:light-dark(#f4f4f5,_#231719)] [border-radius:7px] [padding:18px] [font-size:12px] [color:#ffb4ae] [line-height:1.8] [overflow-wrap:anywhere] [&_p]:[margin-top:5px]"
        >
          {(targets.error || save.error)?.message}
        </p>
      )}
      {save.isSuccess && (
        <p role="status" className="text-sm text-emerald-300">
          Connections saved. Deploy again to apply them.
        </p>
      )}
      <p className="text-xs text-muted">
        Connection changes apply on the next deployment, including pre-deploy tasks and jobs.
        Existing instances keep their recorded connections. Only declared destinations are
        reachable; database and storage credentials remain managed by their own connection settings.
      </p>
    </section>
  )
}
