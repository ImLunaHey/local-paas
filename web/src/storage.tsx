import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { HardDrive } from 'lucide-react'
import { api, type Service } from './api'
import { Button, Field, Input, Select } from './ui'
interface Volume {
  id: string
  name: string
  size_gib: number
  node: string | null
  services: { id: string; name: string; mount_path: string; read_only: boolean }[]
}
export function StoragePanel({ service }: { service: Service }) {
  const client = useQueryClient(),
    current = service.spec.volume
  const [id, setId] = useState(current?.id ?? ''),
    [path, setPath] = useState(current?.mount_path ?? '/data'),
    [readOnly, setReadOnly] = useState(current?.read_only ?? false)
  const [name, setName] = useState(''),
    [size, setSize] = useState(1)
  const operation = useRef<{ key: string; id: string } | null>(null)
  const scope = { project: service.spec.project, environment: service.spec.environment }
  const volumes = useQuery({
    queryKey: ['volumes', scope.project, scope.environment],
    queryFn: () => api<{ items: Volume[] }>('/volumes?' + new URLSearchParams(scope)),
    refetchInterval: 5000,
  })
  const selected = volumes.data?.items.find((v) => v.id === id)
  const create = useMutation({
    mutationFn: () => {
      const key = JSON.stringify({ name, size, ...scope })
      if (operation.current?.key !== key) operation.current = { key, id: crypto.randomUUID() }
      return api<{ id: string }>('/volumes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...scope,
          name,
          size_gib: size,
          operation_id: operation.current.id,
        }),
      })
    },
    onSuccess: async (v) => {
      operation.current = null
      setId(v.id)
      setName('')
      await client.invalidateQueries({ queryKey: ['volumes'] })
    },
  })
  const save = useMutation({
    mutationFn: () =>
      api<Service>('/services/' + service.id, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operation_id: crypto.randomUUID(),
          expected_version: service.version,
          spec: {
            ...service.spec,
            volume: id ? { id, mount_path: path, read_only: readOnly } : undefined,
            workload:
              service.spec.workload.kind === 'oci-service' && id
                ? { ...service.spec.workload, replicas: 1 }
                : service.spec.workload,
          },
        }),
      }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['services'] })
      await client.invalidateQueries({ queryKey: ['volumes'] })
    },
  })
  return (
    <section className="panel space-y-5 p-6 mt-6">
      <div className="flex items-center gap-3">
        <HardDrive size={20} className="text-accent" />
        <h2>Persistent storage</h2>
      </div>
      <p className="text-xs leading-relaxed text-muted">
        Share a volume between services in this environment. All attached services run on its owning
        worker. A file browser can use a read-only attachment while your app writes files.
      </p>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          save.mutate()
        }}
      >
        <div className="grid gap-4 sm:grid-cols-3 items-end">
          <Field label="Volume">
            <Select
              value={id}
              onChange={(e) => {
                setId(e.target.value)
                save.reset()
              }}
            >
              <option value="">No persistent volume</option>
              {volumes.data?.items.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name} · {v.size_gib} GiB
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Mount path">
            <Input
              value={path}
              onChange={(e) => setPath(e.target.value)}
              disabled={!id}
              required={!!id}
              placeholder="/data"
            />
          </Field>
          <Field label="Access">
            <Select
              value={readOnly ? 'ro' : 'rw'}
              onChange={(e) => setReadOnly(e.target.value === 'ro')}
              disabled={!id}
            >
              <option value="rw">Read and write</option>
              <option value="ro">Read only</option>
            </Select>
          </Field>
        </div>
        {selected && (
          <div className="rounded-lg border border-zinc-800 p-4 text-xs space-y-2">
            <p>
              {selected.node ? `Stored on ${selected.node}` : 'Worker assigned at first deployment'}{' '}
              · {selected.size_gib} GiB
            </p>
            {selected.services.length > 0 ? (
              <ul className="space-y-1 text-muted">
                {selected.services.map((s) => (
                  <li key={s.id}>
                    {s.name} → {s.mount_path} · {s.read_only ? 'read only' : 'read/write'}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted">No services attached yet.</p>
            )}
          </div>
        )}
        <p className="text-xs text-muted">
          Attaching storage sets this service to one replica. Stop it before deploying a
          replacement; other services using the volume keep running. Detaching retains all files.
          Coordinate concurrent writes in your applications.
        </p>
        <Button variant="primary" type="submit" disabled={save.isPending}>
          Save storage attachment
        </Button>
        {save.isSuccess && (
          <p role="status" className="text-xs text-emerald-300">
            Attachment saved. Deploy to use it.
          </p>
        )}
      </form>
      <details className="border-t border-zinc-800 pt-4">
        <summary className="cursor-pointer text-sm">Create a shared volume</summary>
        <form
          className="mt-4 grid gap-4 sm:grid-cols-[1fr_120px_auto] items-end"
          onSubmit={(e) => {
            e.preventDefault()
            create.mutate()
          }}
        >
          <Field label="Volume name">
            <Input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
              placeholder="uploads"
              maxLength={63}
            />
          </Field>
          <Field label="Size (GiB)">
            <Input
              required
              type="number"
              min={1}
              max={2}
              value={size}
              onChange={(e) => setSize(Number(e.target.value))}
            />
          </Field>
          <Button type="submit" disabled={create.isPending}>
            Create volume
          </Button>
        </form>
        <p className="mt-3 text-xs text-muted">
          Development volumes are limited to 2 GiB and stay on one worker. They are not replicated
          or backed up automatically.
        </p>
      </details>
      {(volumes.error || save.error || create.error) && (
        <p role="alert" className="error-notice">
          {(volumes.error || save.error || create.error)?.message}
        </p>
      )}
    </section>
  )
}
