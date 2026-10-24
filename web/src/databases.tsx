import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { Database } from 'lucide-react'
import { api, type Service, type ServiceSpec } from './api'
import { Button, Field, Input, Select } from './ui'
import { ProjectBackLink } from './projects'
export function DatabaseForm({
  service,
  initialEngine = 'postgres-service',
}: {
  service?: Service
  initialEngine?: 'postgres-service' | 'rustfs-service'
}) {
  const scope = useSearch({ strict: false }) as { project?: string; environment?: string }
  const navigate = useNavigate(),
    client = useQueryClient()
  const [engine, setEngine] = useState<'postgres-service' | 'redis-service' | 'rustfs-service'>(
    service?.spec.workload.kind === 'redis-service'
      ? 'redis-service'
      : service?.spec.workload.kind === 'rustfs-service'
        ? 'rustfs-service'
        : initialEngine,
  )
  const pg = service?.spec.workload.kind === 'postgres-service' ? service.spec.workload : undefined
  const capabilities = useQuery({
    queryKey: ['build-system'],
    queryFn: () => api<{ database_runtime_ready: boolean }>('/build-system'),
    refetchInterval: 5000,
  })
  const operation = useRef<{ input: string; id: string } | null>(null)
  const mutation = useMutation({
    mutationFn: (spec: ServiceSpec) => {
      const input = JSON.stringify({ spec, version: service?.version })
      if (operation.current?.input !== input) operation.current = { input, id: crypto.randomUUID() }
      return api<Service>(service ? '/services/' + service.id : '/services', {
        method: service ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          spec,
          operation_id: operation.current.id,
          expected_version: service?.version,
        }),
      })
    },
    onSuccess: async (saved) => {
      operation.current = null
      await client.invalidateQueries({ queryKey: ['services'] })
      await client.invalidateQueries({ queryKey: ['projects'] })
      if (!service)
        void navigate({ to: '/services/$serviceId/builds', params: { serviceId: saved.id } })
    },
  })
  return (
    <>
      {!service && (
        <>
          <ProjectBackLink project={scope.project} environment={scope.environment} />
          <div className="page-heading">
            <div>
              <div className="eyebrow">NEW DATABASE</div>
              <h1>{engine === 'rustfs-service' ? 'Create S3 storage' : 'Create a database'}</h1>
              <p>A private database with a persistent volume on one worker.</p>
            </div>
          </div>
        </>
      )}
      <form
        className="panel max-w-3xl space-y-5 p-6"
        onSubmit={(e) => {
          e.preventDefault()
          const data = new FormData(e.currentTarget)
          const text = (name: string) => String(data.get(name) ?? '')
          mutation.mutate({
            schema_version: 1,
            project: text('project'),
            environment: text('environment'),
            name: text('name'),
            source: { repository: '' },
            resources: { cpu_millis: Number(text('cpu')), memory_mib: Number(text('memory')) },
            distinct_nodes: false,
            domains: [],
            secrets: service?.spec.secrets ?? [],
            workload:
              engine === 'postgres-service'
                ? { kind: engine, database: text('database'), storage_gib: Number(text('storage')) }
                : { kind: engine, storage_gib: Number(text('storage')) },
          })
        }}
      >
        <div className="flex items-center gap-3">
          <Database size={21} className="text-accent" />
          <h2>
            {service
              ? engine === 'rustfs-service'
                ? 'Object storage configuration'
                : 'Database configuration'
              : 'Choose an engine'}
          </h2>
        </div>
        <Field label="Database engine">
          <Select
            value={engine}
            disabled={!!service}
            onChange={(e) => setEngine(e.target.value as typeof engine)}
          >
            <option value="postgres-service">PostgreSQL 18 · relational database</option>
            <option value="redis-service">Redis 8 · cache and key-value store</option>
            <option value="rustfs-service">RustFS · S3 object storage</option>
          </Select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <input
            type="hidden"
            name="project"
            value={service?.spec.project ?? scope.project ?? ''}
          />
          <input
            type="hidden"
            name="environment"
            value={service?.spec.environment ?? scope.environment ?? ''}
          />
          <Field label="Service name">
            <Input
              name="name"
              required
              key={engine}
              defaultValue={
                service?.spec.name ??
                (engine === 'redis-service'
                  ? 'redis'
                  : engine === 'rustfs-service'
                    ? 'storage'
                    : 'postgres')
              }
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
            />
          </Field>
          {engine === 'postgres-service' && (
            <Field label="Database name">
              <Input
                name="database"
                required
                readOnly={!!service}
                defaultValue={pg?.database ?? 'app'}
                pattern="[a-z0-9_]+"
                maxLength={63}
              />
            </Field>
          )}
          <Field label="CPU (millicores)">
            <Input
              name="cpu"
              required
              type="number"
              min={100}
              max={1000}
              defaultValue={service?.spec.resources.cpu_millis ?? 250}
            />
          </Field>
          <Field label="Memory (MiB)">
            <Input
              name="memory"
              required
              type="number"
              min={engine === 'rustfs-service' ? 1024 : 256}
              key={engine}
              max={1400}
              defaultValue={
                service?.spec.resources.memory_mib ?? (engine === 'rustfs-service' ? 1024 : 512)
              }
            />
          </Field>
          <Field label="Persistent storage (GiB)">
            <Input
              name="storage"
              required
              type="number"
              min={1}
              max={2}
              readOnly={!!service}
              defaultValue={
                service?.spec.workload.kind === 'redis-service' ||
                service?.spec.workload.kind === 'rustfs-service'
                  ? service.spec.workload.storage_gib
                  : (pg?.storage_gib ?? 1)
              }
            />
          </Field>
        </div>
        <p className="text-xs leading-relaxed text-muted">
          A password is generated in OpenBao at first deployment. The database stays on its owning
          worker and cannot automatically move to another node. Deploying again requires a confirmed
          stop first. Storage and database name cannot change after allocation.
        </p>
        <p className="text-xs text-orange-300">
          Development database: configure and test backups before storing important data.
        </p>
        {mutation.error && (
          <p role="alert" className="error-notice">
            {mutation.error.message}
          </p>
        )}
        {mutation.isSuccess && service && <p role="status">Database configuration saved.</p>}
        <Button
          variant="primary"
          type="submit"
          disabled={mutation.isPending || (!service && !capabilities.data?.database_runtime_ready)}
        >
          {service
            ? 'Save changes'
            : capabilities.data?.database_runtime_ready
              ? engine === 'rustfs-service'
                ? 'Create S3 storage'
                : 'Create database'
              : 'Waiting for database workers'}
        </Button>
      </form>
    </>
  )
}
export interface DatabaseState {
  volume: { node: string; size_gib: number; host: string; port: number } | null
  applications: { id: string; name: string; connected: boolean | null }[]
}
export function DatabasePanel({ service }: { service: Service }) {
  const secretName = service.spec.workload.kind === 'redis-service' ? 'REDIS_URL' : 'DATABASE_URL'
  const client = useQueryClient(),
    [app, setApp] = useState('')
  const query = useQuery({
    queryKey: ['database', service.id],
    queryFn: () => api<DatabaseState>('/services/' + service.id + '/database'),
    refetchInterval: 5000,
  })
  const connect = useMutation({
    mutationFn: async () => {
      const secrets = await api<{ version: number }>('/services/' + app + '/secrets')
      return api('/services/' + app + '/database-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ database_id: service.id, expected_secret_version: secrets.version }),
      })
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['database', service.id] })
      await client.invalidateQueries({ queryKey: ['secrets'] })
    },
  })
  return (
    <section className="panel space-y-5 p-6">
      <div className="section-heading">
        <h2>Database connections</h2>
        <span className="chip">Private · node pinned</span>
      </div>
      {query.data?.volume ? (
        <div className="revision-row text-sm">
          {query.data.volume.node} · {query.data.volume.size_gib} GiB persistent storage
          <p className="mt-2 text-xs text-muted">
            Only explicitly connected services may reach this database.
          </p>
        </div>
      ) : (
        <p className="text-xs text-muted">
          Deploy the database image to allocate its volume and private endpoint.
        </p>
      )}
      <Field
        label="Connect an application"
        hint="Choose an application in this project and environment. This replaces its connection secret; redeploy it afterward."
      >
        <Select
          value={app}
          onChange={(e) => {
            setApp(e.target.value)
            connect.reset()
          }}
        >
          <option value="">Choose service</option>
          {query.data?.applications.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
              {a.connected ? ' · connected' : ''}
            </option>
          ))}
        </Select>
      </Field>
      <Button
        variant="primary"
        disabled={!app || !query.data?.volume || connect.isPending}
        onClick={() => connect.mutate()}
      >
        Set {secretName}
      </Button>
      {(query.error || connect.error) && (
        <p role="alert" className="error-notice">
          {(query.error || connect.error)?.message}
        </p>
      )}
      {connect.isSuccess && (
        <p role="status" className="text-xs text-emerald-300">
          Connection saved in OpenBao. Redeploy the application to use it.
        </p>
      )}
      <p className="text-xs text-muted">
        Stopping or replacing the database process retains its volume. Worker loss leaves the
        database unavailable until that same worker and disk return.
      </p>
    </section>
  )
}
