import { EnvironmentManager, environmentsQuery } from './environments'
import { Networking } from './networking'
import { cloneElement, useId, createContext, StrictMode, useContext, useRef, useState } from 'react'
import type { FormEvent, ReactElement, ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import {
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  Outlet,
  RouterProvider,
  redirect,
  useNavigate,
} from '@tanstack/react-router'
import {
  ArrowDownLeft,
  ArrowLeft,
  ArrowRight,
  AlertCircle,
  Box,
  Check,
  ChevronRight,
  Circle,
  Code2,
  Layers3,
  LoaderCircle,
  Plus,
  Radio,
  Server,
  ShieldCheck,
  Terminal,
  Workflow,
} from 'lucide-react'
import { api, serviceQuery, sourceLabel, sourceReference } from './api'
import type { AuditEvent, Service, ServiceSpec, SourceKind, Workload } from './api'
import './styles.css'
import { BuildPanel } from './builds'
import { DeploymentPanel, RuntimePanel, useRuntime, runtimeLabel } from './runtime'

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 5_000 } } })

function Shell() {
  const health = useQuery({
    queryKey: ['health'],
    queryFn: () => api<{ status: string }>('/health'),
    refetchInterval: 15_000,
  })
  return (
    <div className="min-h-screen">
      <aside className="sidebar">
        <Link to="/" className="brand">
          <span className="brand-mark">
            <Layers3 size={21} />
          </span>
          <span>
            local<span className="text-muted"> / </span>paas
          </span>
        </Link>
        <div className="workspace">
          <div className="workspace-icon">L</div>
          <div>
            <strong>Personal workspace</strong>
            <span>Local development</span>
          </div>
        </div>
        <div className="nav-label">WORKSPACE</div>
        <Link to="/" className="nav-item">
          <Box size={17} /> Services <ChevronRight size={14} className="ml-auto" />
        </Link>
        <Link to="/environments" className="nav-item">
          <Layers3 size={17} /> Environments
        </Link>
        <div className="sidebar-note">
          <ShieldCheck size={19} />
          <p>
            Your infrastructure.
            <br />
            <span>Your control.</span>
          </p>
        </div>
        <div className="sidebar-bottom">
          <span className="tiny-label">CONTROL PLANE</span>
          <span className="flex items-center gap-2 text-xs mt-2">
            <i className={`status-dot ${health.isSuccess ? 'online' : ''}`} />
            {health.isPending
              ? 'Connecting…'
              : health.isError
                ? 'API unavailable'
                : 'Connected locally'}
          </span>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <span className="flex items-center gap-2">
            <span className="text-muted">Workspace</span>
            <ChevronRight size={13} />
            Services
          </span>
          <span className="environment-tag">
            <span className="status-dot" /> Private platform
          </span>
        </header>
        <main>
          <Outlet />
        </main>
        <footer>
          Built for a smaller cloud.
          <span>
            local-paas <span className="text-muted">/</span> 0.1.0
          </span>
        </footer>
      </div>
    </div>
  )
}

function ErrorNotice({ error, retry }: { error: Error; retry?: () => void }) {
  return (
    <div className="error-notice" role="alert">
      <strong>Something needs attention</strong>
      <p className="whitespace-pre-line">{error.message}</p>
      {retry && (
        <button className="button secondary mt-3" onClick={retry}>
          Try again
        </button>
      )}
    </div>
  )
}

function Services() {
  const [offset, setOffset] = useState(0)
  const [environmentId, setEnvironmentId] = useState('')
  const environments = useQuery(environmentsQuery)
  const selectedEnvironment = environments.data?.items.find((e) => e.id === environmentId)
  const filterParams = new URLSearchParams({ offset: String(offset) })
  if (selectedEnvironment) {
    filterParams.set('project', selectedEnvironment.project)
    filterParams.set('environment', selectedEnvironment.name)
  }
  const services = useQuery({
    queryKey: ['services', { offset, environmentId }],
    queryFn: () => api<{ items: Service[]; total: number }>('/services?' + filterParams),
  })
  const builder = useQuery({
    queryKey: ['build-system'],
    queryFn: () => api<{ worker_online: boolean }>('/build-system'),
    refetchInterval: 5000,
  })
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">YOUR WORKSPACE</div>
          <h1>Services</h1>
          <p>Your applications, builds, and image revisions.</p>
        </div>
        <Link className="button primary" to="/services/new">
          <Plus size={17} />
          Register service
        </Link>
      </div>
      <label className="field mb-5">
        Environment
        <select
          aria-label="Filter environment"
          value={environmentId}
          onChange={(e) => {
            setEnvironmentId(e.target.value)
            setOffset(0)
          }}
        >
          <option value="">All environments</option>
          {environments.data?.items.map((e) => (
            <option key={e.id} value={e.id}>
              {e.project} / {e.name}
            </option>
          ))}
        </select>
      </label>
      <div className="phase-banner">
        <span className="phase-icon">
          <Terminal size={19} />
        </span>
        <div>
          <strong>From source to image.</strong>
          <p>
            Build and deploy your services. Keep deployments, networking and secrets scoped to their
            environment.
          </p>
        </div>
        <span className="chip ml-auto">Development preview</span>
      </div>
      <div className="grid sm:grid-cols-3 gap-4 mt-7 mb-9">
        <Metric
          icon={<Box size={17} />}
          label="Registered services"
          value={services.data ? String(services.data.total) : '—'}
          detail="Applications in this workspace"
        />
        <Metric
          icon={<Server size={17} />}
          label="Image builder"
          value={
            builder.isPending
              ? 'Connecting'
              : builder.isError
                ? 'Unavailable'
                : builder.data.worker_online
                  ? 'Connected'
                  : 'Offline'
          }
          detail="Build worker connection"
        />
        <Metric
          icon={<Radio size={17} />}
          label="Deployments"
          value="Coming next"
          detail="No workloads are running on this platform"
        />
      </div>
      <div className="section-heading">
        <h2>
          Services <span className="count">{services.data?.total ?? '—'}</span>
        </h2>
        <span className="tiny-label">OCI CONTAINERS & CELLD FLEETS</span>
      </div>
      {services.isPending ? (
        <div className="panel p-12 text-muted flex items-center justify-center gap-3">
          <LoaderCircle className="animate-spin" size={18} />
          Loading services…
        </div>
      ) : services.isError ? (
        <ErrorNotice
          error={services.error}
          retry={() => {
            void services.refetch()
          }}
        />
      ) : services.data.total === 0 ? (
        <div className="empty-state">
          <div className="empty-illustration" aria-hidden="true">
            <div className="orbit orbit-one" />
            <div className="orbit orbit-two" />
            <span className="empty-box">
              <Box size={33} strokeWidth={1.3} />
            </span>
            <span className="small-node node-left">
              <Code2 size={15} />
            </span>
            <span className="small-node node-right">
              <Server size={15} />
            </span>
          </div>
          <h2>Your next application starts here.</h2>
          <p>
            Connect a Dockerfile-based service or a dedicated celld fleet.
            <br className="hidden sm:block" /> A small specification keeps the important details
            together.
          </p>
          <Link to="/services/new" className="button primary mt-6">
            <Plus size={16} />
            Register your first service
          </Link>
          <span className="empty-footnote">
            <ShieldCheck size={13} /> Configuration only. Nothing is deployed yet.
          </span>
        </div>
      ) : (
        <div className="panel overflow-hidden">
          <div className="service-table-head">
            <span>SERVICE / SOURCE</span>
            <span>WORKLOAD</span>
            <span>STATUS</span>
          </div>
          {services.data.items.map((service) => (
            <ServiceRow key={service.id} service={service} />
          ))}
          {services.data.total > 50 && (
            <div className="flex justify-between items-center p-4">
              <button
                className="button secondary"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - 50))}
              >
                Previous
              </button>
              <span className="text-xs text-muted">
                {offset + 1}–{Math.min(offset + 50, services.data.total)} of {services.data.total}
              </span>
              <button
                className="button secondary"
                disabled={offset + 50 >= services.data.total}
                onClick={() => setOffset(offset + 50)}
              >
                Next
              </button>
            </div>
          )}
        </div>
      )}
      <div className="grid md:grid-cols-2 gap-5 mt-7">
        <div className="workload-card">
          <div className="flex items-center gap-3">
            <Box size={18} />
            <h3>Dockerfile services</h3>
            <span className="tiny-label ml-auto">OCI</span>
          </div>
          <p>
            A familiar build contract for your web apps and APIs. Immutable images, explicit
            resources, and build logs in one place.
          </p>
          <div className="pipeline">
            <span>Repository</span>
            <ArrowRight size={12} />
            <span>BuildKit</span>
            <ArrowRight size={12} />
            <span>Image</span>
          </div>
        </div>
        <div className="workload-card">
          <div className="flex items-center gap-3">
            <Workflow size={18} />
            <h3>celld applications</h3>
            <span className="tiny-label ml-auto">FLEET</span>
          </div>
          <p>
            Your Wrangler project with its own dedicated fleet. Workers and Durable Objects, with a
            separate storage and lifecycle contract.
          </p>
          <div className="pipeline">
            <span>Wrangler</span>
            <ArrowRight size={12} />
            <span>celld deploy</span>
            <ArrowRight size={12} />
            <span>Fleet</span>
          </div>
        </div>
      </div>
    </>
  )
}

function Metric({
  icon,
  label,
  value,
  detail,
}: {
  icon: ReactNode
  label: string
  value: string
  detail: string
}) {
  return (
    <div className="metric">
      <div className="flex items-center justify-between text-muted text-xs">
        {label}
        {icon}
      </div>
      <strong>{value}</strong>
      <p>{detail}</p>
    </div>
  )
}

function ServiceRow({ service }: { service: Service }) {
  const { spec } = service
  return (
    <Link to="/services/$serviceId" params={{ serviceId: service.id }} className="service-row">
      <div className="flex items-center gap-3 min-w-0">
        <span className="service-icon">
          {spec.workload.kind === 'oci-service' ? <Box size={19} /> : <Workflow size={19} />}
        </span>
        <div className="min-w-0">
          <h3>{spec.name}</h3>
          <p className="truncate">
            {spec.project} / {spec.environment}
            <span className="mx-2">·</span>
            {sourceLabel(spec.source)}
          </p>
        </div>
      </div>
      <span className="text-xs text-muted">
        {spec.workload.kind === 'oci-service'
          ? `${spec.workload.replicas} requested replicas`
          : `${spec.workload.members} requested members`}
      </span>
      <span className="flex items-center justify-between gap-4">
        <span className="chip">
          <Circle size={9} />
          Registered
        </span>
        <ChevronRight size={16} className="text-muted" />
      </span>
    </Link>
  )
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactElement<{ id?: string; 'aria-describedby'?: string }>
}) {
  const id = useId()
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {cloneElement(children, { id, 'aria-describedby': hint ? id + '-hint' : undefined })}
      {hint && <small id={id + '-hint'}>{hint}</small>}
    </div>
  )
}

function NewService() {
  return <ServiceForm />
}

function ServiceForm({ service }: { service?: Service }) {
  const [baseline, setBaseline] = useState(service)
  const spec = baseline?.spec
  const oci = spec?.workload.kind === 'oci-service' ? spec.workload : undefined
  const celld = spec?.workload.kind === 'celld-service' ? spec.workload : undefined
  const initialRef = spec ? sourceReference(spec.source) : { kind: 'commit' as const, value: '' }
  const [sourceKind, setSourceKind] = useState<SourceKind>(initialRef.kind)
  const [sourceValue, setSourceValue] = useState(initialRef.value)
  const [buildMode, setBuildMode] = useState<'auto' | 'dockerfile' | 'generated'>(
    oci?.build_mode ?? 'auto',
  )
  const knownEnvironments = useQuery(environmentsQuery)
  const [dirty, setDirty] = useState(false)
  const [formVersion, setFormVersion] = useState(0)
  const [reloading, setReloading] = useState(false)
  const [reloadError, setReloadError] = useState<Error | null>(null)
  const navigate = useNavigate()
  const client = useQueryClient()
  const [kind, setKind] = useState<Workload['kind']>(spec?.workload.kind ?? 'oci-service')
  // Preserve the operation ID across retries of an identical submission, even
  // if a response was lost. A changed spec is a different operation.
  const pending = useRef<{ serialized: string; id: string } | null>(null)
  const mutation = useMutation({
    mutationFn: async (spec: ServiceSpec) => {
      const serialized = JSON.stringify({ spec, version: baseline?.version })
      if (pending.current?.serialized !== serialized)
        pending.current = { serialized, id: crypto.randomUUID() }
      return api<Service>(baseline ? `/services/${baseline.id}` : '/services', {
        method: baseline ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operation_id: pending.current.id,
          expected_version: baseline?.version,
          spec,
        }),
      })
    },
    onSuccess: async (service) => {
      pending.current = null
      await client.invalidateQueries({ queryKey: ['services'] })
      if (baseline) {
        setBaseline(service)
        setDirty(false)
        await client.invalidateQueries({ queryKey: ['events', service.id] })
        return
      }
      await navigate({ to: '/services/$serviceId', params: { serviceId: service.id } })
    },
  })
  async function reloadSaved() {
    if (!baseline) return
    setReloading(true)
    setReloadError(null)
    try {
      const saved = await api<Service>(`/services/${baseline.id}`)
      setBaseline(saved)
      if (saved.spec.workload.kind === 'oci-service')
        setBuildMode(saved.spec.workload.build_mode ?? 'auto')
      const ref = sourceReference(saved.spec.source)
      setSourceKind(ref.kind)
      setSourceValue(ref.value)
      setFormVersion((value) => value + 1)
      setDirty(false)
      pending.current = null
      mutation.reset()
    } catch (error) {
      setReloadError(error as Error)
    } finally {
      setReloading(false)
    }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (mutation.isPending) return
    const data = new FormData(event.currentTarget)
    const text = (key: string) => String(data.get(key) ?? '').trim()
    const number = (key: string) => Number(text(key))
    const list = (key: string) =>
      text(key)
        .split(/[\s,]+/)
        .filter(Boolean)
    const workload: Workload =
      kind === 'oci-service'
        ? {
            kind,
            build_mode: buildMode,
            build_command:
              buildMode === 'dockerfile' ? undefined : text('build_command') || undefined,
            start_command:
              buildMode === 'dockerfile' ? undefined : text('start_command') || undefined,
            dockerfile: text('dockerfile'),
            context: text('context'),
            replicas: number('replicas'),
            port: number('port'),
            readiness: {
              path: text('readiness'),
              interval_seconds: number('interval'),
              stabilization_seconds: number('stabilization'),
            },
          }
        : {
            kind,
            wrangler: text('wrangler'),
            members: number('members'),
            bucket_ref: text('bucket'),
          }
    mutation.mutate({
      schema_version: 1,
      project: text('project'),
      environment: text('environment'),
      name: text('name'),
      source: { repository: text('repository'), [sourceKind]: sourceValue.trim() },
      resources: { cpu_millis: number('cpu'), memory_mib: number('memory') },
      distinct_nodes: data.has('distinct'),
      domains: list('domains'),
      secrets: list('secrets'),
      workload,
    })
  }
  return (
    <>
      {!baseline && (
        <>
          <Link to="/" className="back-link">
            <ArrowLeft size={14} /> All services
          </Link>
          <div className="page-heading">
            <div>
              <div className="eyebrow">NEW SERVICE</div>
              <h1>Give your application a home.</h1>
              <p>Start with its source and the resources it will need.</p>
            </div>
          </div>
        </>
      )}
      <div className="form-layout">
        <form
          key={formVersion}
          onSubmit={submit}
          onChange={() => {
            setDirty(true)
            mutation.reset()
          }}
          className="space-y-5"
          aria-label={baseline ? 'Service configuration' : 'Register service'}
        >
          <fieldset disabled={mutation.isPending || reloading} className="space-y-5">
            <section className="panel form-section">
              <h2>
                <span className="step">01</span> Application
              </h2>
              <div className="grid sm:grid-cols-2 gap-3 mb-6">
                {(['oci-service', 'celld-service'] as const).map((type) => (
                  <button
                    type="button"
                    disabled={!!baseline}
                    aria-pressed={kind === type}
                    className={`kind-option ${kind === type ? 'selected' : ''}`}
                    key={type}
                    onClick={() => {
                      setKind(type)
                      mutation.reset()
                    }}
                  >
                    {type === 'oci-service' ? <Box size={20} /> : <Workflow size={20} />}
                    <span>
                      <strong>
                        {type === 'oci-service' ? 'Dockerfile service' : 'celld application'}
                      </strong>
                      <small>
                        {type === 'oci-service' ? 'Web apps & APIs' : 'Workers & Durable Objects'}
                      </small>
                    </span>
                    {kind === type && <Check size={15} className="ml-auto text-accent" />}
                  </button>
                ))}
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                <Field label="Project">
                  <input
                    name="project"
                    readOnly={!!service}
                    defaultValue={spec?.project}
                    placeholder="personal"
                    required
                    pattern="[a-z0-9]+(-[a-z0-9]+)*"
                    maxLength={63}
                  />
                </Field>
                <datalist id="known-environments">
                  {knownEnvironments.data?.items.map((e) => (
                    <option key={e.id} value={e.name}>
                      {e.project}
                    </option>
                  ))}
                </datalist>
                <Field label="Environment">
                  <input
                    name="environment"
                    readOnly={!!service}
                    list="known-environments"
                    defaultValue={spec?.environment ?? 'development'}
                    required
                    pattern="[a-z0-9]+(-[a-z0-9]+)*"
                    maxLength={63}
                  />
                </Field>
                <div className="sm:col-span-2">
                  <Field label="Service name">
                    <input
                      name="name"
                      defaultValue={spec?.name}
                      placeholder={kind === 'oci-service' ? 'my-web-app' : 'my-durable-app'}
                      required
                      pattern="[a-z0-9]+(-[a-z0-9]+)*"
                      maxLength={63}
                    />
                  </Field>
                </div>
              </div>
            </section>
            <section className="panel form-section">
              <h2>
                <span className="step">02</span> Source
              </h2>
              <div className="space-y-4">
                <Field
                  label="Git repository"
                  hint="An HTTPS URL without a token or embedded credentials."
                >
                  <input
                    name="repository"
                    defaultValue={spec?.source.repository}
                    type="url"
                    placeholder="https://github.com/you/your-app.git"
                    required
                    maxLength={2048}
                  />
                </Field>
                <Field label="Source type">
                  <select
                    className="build-select"
                    value={sourceKind}
                    onChange={(event) => setSourceKind(event.target.value as SourceKind)}
                  >
                    <option value="branch">Branch</option>
                    <option value="tag">Tag</option>
                    <option value="commit">Commit</option>
                  </select>
                </Field>
                <Field
                  label={
                    sourceKind === 'commit'
                      ? 'Commit SHA'
                      : sourceKind === 'branch'
                        ? 'Branch'
                        : 'Tag'
                  }
                  hint="Branches and tags are resolved to an exact commit for each build."
                >
                  <input
                    name="source_ref"
                    className="font-mono"
                    value={sourceValue}
                    onChange={(event) => setSourceValue(event.target.value)}
                    required
                    pattern={sourceKind === 'commit' ? '([a-f0-9]{40}|[a-f0-9]{64})' : undefined}
                  />
                </Field>
                {kind === 'oci-service' ? (
                  <>
                    <Field
                      label="Build method"
                      hint="Automatic uses your Dockerfile when present, otherwise generates one for a supported Node or Bun app with a lockfile and start script or custom start command."
                    >
                      <select
                        name="build_mode"
                        className="build-select"
                        value={buildMode}
                        onChange={(event) => setBuildMode(event.target.value as typeof buildMode)}
                      >
                        <option value="auto">Automatic (Dockerfile or language detection)</option>
                        <option value="dockerfile">Repository Dockerfile only</option>
                        <option value="generated">Generate Dockerfile from app</option>
                      </select>
                    </Field>
                    {buildMode !== 'dockerfile' && (
                      <>
                        <Field
                          label="Build command (optional)"
                          hint="Blank uses scripts.build when present. A custom command selects a generated Dockerfile, even if the repository has one. Commands run inside the builder; use secret references for secrets."
                        >
                          <input
                            name="build_command"
                            defaultValue={oci?.build_command}
                            placeholder="npm run build"
                            maxLength={4096}
                          />
                        </Field>
                        <Field
                          label="Start command (optional)"
                          hint="Blank uses scripts.start. A custom command selects a generated Dockerfile and runs when an instance starts."
                        >
                          <input
                            name="start_command"
                            defaultValue={oci?.start_command}
                            placeholder="npm start"
                            maxLength={4096}
                          />
                        </Field>
                      </>
                    )}
                    <div className="grid sm:grid-cols-2 gap-4">
                      <Field label="Dockerfile path">
                        <input
                          name="dockerfile"
                          defaultValue={oci?.dockerfile ?? 'Dockerfile'}
                          required
                        />
                      </Field>
                      <Field label="Build context">
                        <input name="context" defaultValue={oci?.context ?? '.'} required />
                      </Field>
                    </div>
                  </>
                ) : (
                  <>
                    <Field label="Wrangler configuration">
                      <input
                        name="wrangler"
                        defaultValue={celld?.wrangler ?? 'wrangler.jsonc'}
                        required
                      />
                    </Field>
                    <Field
                      label="Bucket configuration reference"
                      hint="A dedicated fleet's storage reference. Do not enter credentials."
                    >
                      <input
                        name="bucket"
                        defaultValue={celld?.bucket_ref}
                        placeholder="my-durable-app-bucket"
                        required
                        pattern="[a-z0-9]+(-[a-z0-9]+)*"
                      />
                    </Field>
                  </>
                )}
              </div>
            </section>
            <section className="panel form-section">
              <h2>
                <span className="step">03</span> Runtime requirements
              </h2>
              <div className="grid sm:grid-cols-2 gap-4">
                <Field label="CPU per instance (millicores)">
                  <input
                    name="cpu"
                    type="number"
                    defaultValue={spec?.resources.cpu_millis ?? 500}
                    min={1}
                    max={64000}
                    required
                  />
                </Field>
                <Field label="Memory per instance (MiB)">
                  <input
                    name="memory"
                    type="number"
                    defaultValue={spec?.resources.memory_mib ?? 512}
                    min={16}
                    max={65536}
                    required
                  />
                </Field>
                {kind === 'oci-service' ? (
                  <>
                    <Field label="Replicas">
                      <input
                        name="replicas"
                        type="number"
                        defaultValue={oci?.replicas ?? 2}
                        min={1}
                        max={32}
                        required
                      />
                    </Field>
                    <Field label="HTTP port">
                      <input
                        name="port"
                        type="number"
                        defaultValue={oci?.port ?? 3000}
                        min={1}
                        max={65535}
                        required
                      />
                    </Field>
                    <div className="sm:col-span-2">
                      <Field label="Readiness path">
                        <input
                          name="readiness"
                          defaultValue={oci?.readiness.path ?? '/health'}
                          required
                        />
                      </Field>
                    </div>
                    <Field label="Check interval (seconds)">
                      <input
                        name="interval"
                        type="number"
                        defaultValue={oci?.readiness.interval_seconds ?? 10}
                        min={1}
                        max={300}
                        required
                      />
                    </Field>
                    <Field label="Stabilization period (seconds)">
                      <input
                        name="stabilization"
                        type="number"
                        defaultValue={oci?.readiness.stabilization_seconds ?? 30}
                        min={1}
                        max={3600}
                        required
                      />
                    </Field>
                  </>
                ) : (
                  <Field label="Fleet members">
                    <input
                      name="members"
                      type="number"
                      defaultValue={celld?.members ?? 3}
                      min={2}
                      max={32}
                      required
                    />
                  </Field>
                )}
              </div>
              <label className="checkbox-field">
                <input
                  type="checkbox"
                  name="distinct"
                  defaultChecked={spec?.distinct_nodes ?? true}
                />
                <span>
                  Spread across distinct nodes
                  <small>Different VMs on Lake still share one physical failure domain.</small>
                </span>
              </label>
            </section>
            <section className="panel form-section">
              <h2>
                <span className="step">04</span> Domains & secrets
              </h2>
              <div className="space-y-4">
                <Field
                  label="Domains (optional)"
                  hint="Separate with commas. Domains will not be routed or verified yet."
                >
                  <input
                    name="domains"
                    defaultValue={spec?.domains.join(', ')}
                    placeholder="api.example.com"
                  />
                </Field>
                <Field
                  label="Secret names (optional)"
                  hint="Names only, separated by commas. Values belong in OpenBao."
                >
                  <input
                    name="secrets"
                    defaultValue={spec?.secrets.join(', ')}
                    placeholder="DATABASE_URL, SESSION_SECRET"
                  />
                </Field>
              </div>
            </section>
            {baseline && mutation.isSuccess && !dirty && (
              <p role="status" className="text-sm text-accent">
                Configuration saved.
              </p>
            )}
            {reloadError && <ErrorNotice error={reloadError} />}
            {mutation.isError && <ErrorNotice error={mutation.error} />}
            <div className="flex items-center justify-between gap-3">
              {baseline ? (
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => {
                    void reloadSaved()
                  }}
                >
                  Reload saved configuration
                </button>
              ) : (
                <Link to="/" className="button secondary">
                  Cancel
                </Link>
              )}
              <button
                type="submit"
                className="button primary"
                disabled={mutation.isPending || (!!baseline && !dirty)}
              >
                {mutation.isPending ? (
                  <LoaderCircle className="animate-spin" size={16} />
                ) : baseline ? (
                  <Check size={16} />
                ) : (
                  <Plus size={16} />
                )}
                {mutation.isPending
                  ? baseline
                    ? 'Saving…'
                    : 'Registering…'
                  : baseline
                    ? 'Save changes'
                    : 'Register service'}
              </button>
            </div>
          </fieldset>
        </form>
        <aside className="form-aside">
          <span className="service-icon mb-5">
            <ArrowDownLeft size={22} />
          </span>
          <h3>{baseline ? 'Configure your service.' : 'A specification, then a deployment.'}</h3>
          <p>
            Changes apply to future builds. Existing builds and image revisions keep their recorded
            configuration. Saving does not start a build or deploy a workload.
          </p>
          <div className="aside-divider" />
          <h4>What happens next?</h4>
          <p>
            {kind === 'oci-service'
              ? 'The build pipeline will turn this source and Dockerfile into an immutable OCI image before scheduling instances.'
              : 'A dedicated deployment runner will validate Wrangler, deploy the application, and coordinate its fleet.'}
          </p>
          <div className="aside-divider" />
          <span className="flex gap-2 text-xs text-muted">
            <ShieldCheck size={15} className="shrink-0" />
            Secret values never belong in this form.
          </span>
        </aside>
      </div>
    </>
  )
}

const CurrentService = createContext<Service | null>(null)

function useCurrentService() {
  const service = useContext(CurrentService)
  if (!service) throw new Error('Service view must be inside a service page')
  return service
}

function ServiceDetail() {
  const { serviceId } = detailRoute.useParams()
  const service = useQuery(serviceQuery(serviceId))
  const runtime = useRuntime(serviceId, service.isSuccess)
  if (service.isPending) return <p className="text-muted">Loading service…</p>
  if (service.isError)
    return (
      <ErrorNotice
        error={service.error}
        retry={() => {
          void service.refetch()
        }}
      />
    )
  const { spec } = service.data
  const count =
    spec.workload.kind === 'oci-service' ? spec.workload.replicas : spec.workload.members
  return (
    <>
      <Link to="/" className="back-link">
        <ArrowLeft size={14} /> All services
      </Link>
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            {spec.project} / {spec.environment}
          </div>
          <h1>{spec.name}</h1>
          <p>
            {spec.workload.kind === 'oci-service'
              ? 'Dockerfile service'
              : 'Dedicated celld application fleet'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {runtime.data?.preview_url ? (
            <a
              className="button primary"
              href={runtime.data.preview_url}
              target="_blank"
              rel="noreferrer"
            >
              Open app ↗
            </a>
          ) : (
            <Link className="button" to="/services/$serviceId/networking" params={{ serviceId }}>
              Set up URL
            </Link>
          )}
          <span className="chip">
            <Circle size={10} />
            {runtime.isError ? 'Runtime status unavailable' : runtimeLabel(runtime.data)}
          </span>
        </div>
      </div>
      <div className="phase-banner">
        <span className="phase-icon">
          <Check size={19} />
        </span>
        <div>
          <strong>
            {runtime.isError ? 'Cannot read runtime status.' : `${runtimeLabel(runtime.data)}.`}
          </strong>
          <p>
            {spec.workload.kind === 'celld-service'
              ? 'The dedicated celld fleet runtime is not implemented yet.'
              : runtimeLabel(runtime.data) === 'Running'
                ? 'The active deployment has ready instances. Logs and metrics report application data.'
                : 'Build an image, then deploy its revision. Readiness checks control when instances can receive traffic.'}
          </p>
        </div>
      </div>
      <div className="grid sm:grid-cols-3 gap-4 my-7">
        <Metric
          icon={<Layers3 size={16} />}
          label={spec.workload.kind === 'oci-service' ? 'Requested replicas' : 'Requested members'}
          value={String(count)}
          detail={
            spec.distinct_nodes
              ? 'Distinct-node placement requested'
              : 'No distinct-node constraint'
          }
        />
        <Metric
          icon={<Server size={16} />}
          label="CPU per instance"
          value={`${spec.resources.cpu_millis}m`}
          detail="Desired allocation"
        />
        <Metric
          icon={<Box size={16} />}
          label="Memory per instance"
          value={`${spec.resources.memory_mib} MiB`}
          detail="Desired allocation"
        />
      </div>
      <nav className="detail-nav" aria-label="Service tabs">
        <Link
          to="/services/$serviceId/networking"
          params={{ serviceId }}
          resetScroll={false}
          activeProps={{ 'aria-current': 'page' }}
        >
          Networking
        </Link>
        <Link
          to="/services/$serviceId/builds"
          params={{ serviceId }}
          resetScroll={false}
          activeProps={{ 'aria-current': 'page' }}
        >
          {spec.workload.kind === 'oci-service' ? 'Builds & revisions' : 'Fleet deployments'}
        </Link>
        <Link
          to="/services/$serviceId/logs"
          params={{ serviceId }}
          resetScroll={false}
          activeProps={{ 'aria-current': 'page' }}
        >
          Logs
        </Link>
        <Link
          to="/services/$serviceId/metrics"
          params={{ serviceId }}
          resetScroll={false}
          activeProps={{ 'aria-current': 'page' }}
        >
          Metrics
        </Link>
        <Link
          to="/services/$serviceId/configuration"
          params={{ serviceId }}
          resetScroll={false}
          activeProps={{ 'aria-current': 'page' }}
        >
          Configuration
        </Link>
        <Link
          to="/services/$serviceId/activity"
          params={{ serviceId }}
          resetScroll={false}
          activeProps={{ 'aria-current': 'page' }}
        >
          Activity
        </Link>
      </nav>
      <CurrentService.Provider value={service.data}>
        <Outlet />
      </CurrentService.Provider>
    </>
  )
}

function ServiceBuilds() {
  const service = useCurrentService()
  return (
    <>
      <DeploymentPanel service={service} />
      <BuildPanel service={service} />
    </>
  )
}

function ServiceConfiguration() {
  const service = useCurrentService()
  return <ServiceForm key={service.id} service={service} />
}

function ServiceRuntime({ view }: { view: 'logs' | 'metrics' }) {
  return <RuntimePanel service={useCurrentService()} view={view} />
}

function ServiceActivity() {
  const service = useCurrentService()
  const events = useQuery({
    queryKey: ['events', service.id],
    queryFn: () => api<AuditEvent[]>(`/services/${service.id}/events`),
    refetchInterval: 3000,
  })
  return (
    <section className="panel p-6" aria-label="Service activity">
      <h2 className="mb-6">Activity</h2>
      {events.isPending ? (
        <p className="text-muted text-sm">Loading activity…</p>
      ) : events.isError ? (
        <ErrorNotice
          error={events.error}
          retry={() => {
            void events.refetch()
          }}
        />
      ) : (
        events.data.map((event) => (
          <div className="activity-event" key={event.id}>
            <span className="activity-dot" data-state={event.kind.split('.')[1]}>
              {event.kind === 'build.failed' || event.kind === 'build.interrupted' ? (
                <AlertCircle size={13} />
              ) : event.kind === 'build.succeeded' || event.kind === 'service.registered' ? (
                <Check size={13} />
              ) : (
                <Circle size={13} />
              )}
            </span>
            <div>
              <h3>
                {event.kind === 'service.registered'
                  ? 'Service registered'
                  : event.kind.replaceAll('.', ' ').replaceAll('_', ' ')}
              </h3>
              {event.kind === 'service.registered' && <p>Desired configuration saved.</p>}
              <time dateTime={event.created_at}>{new Date(event.created_at).toLocaleString()}</time>
            </div>
          </div>
        ))
      )}
      <div className="aside-divider" />
      <p className="text-xs text-muted break-all">
        Service ID
        <br />
        <span className="font-mono">{service.id}</span>
      </p>
    </section>
  )
}

const rootRoute = createRootRoute({
  component: Shell,
  notFoundComponent: () => (
    <div>
      <h1>Page not found</h1>
      <Link to="/" className="back-link mt-5">
        Return to services
      </Link>
    </div>
  ),
})
const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: Services })
const environmentsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/environments',
  component: EnvironmentManager,
})
const networkingRoute = createRoute({
  getParentRoute: () => detailRoute,
  path: 'networking',
  component: () => <Networking service={useCurrentService()} />,
})
const newRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/services/new',
  component: NewService,
})
const detailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/services/$serviceId',
  component: ServiceDetail,
})
const serviceIndexRoute = createRoute({
  getParentRoute: () => detailRoute,
  path: '/',
  beforeLoad: ({ params, location }) => {
    const to =
      location.hash === 'configuration'
        ? '/services/$serviceId/configuration'
        : location.hash === 'activity'
          ? '/services/$serviceId/activity'
          : '/services/$serviceId/builds'
    throw redirect({ to, params, replace: true, hash: '' })
  },
})
const serviceBuildsRoute = createRoute({
  getParentRoute: () => detailRoute,
  path: 'builds',
  component: ServiceBuilds,
})
const serviceConfigurationRoute = createRoute({
  getParentRoute: () => detailRoute,
  path: 'configuration',
  component: ServiceConfiguration,
})
const serviceLogsRoute = createRoute({
  getParentRoute: () => detailRoute,
  path: 'logs',
  component: () => <ServiceRuntime view="logs" />,
})
const serviceMetricsRoute = createRoute({
  getParentRoute: () => detailRoute,
  path: 'metrics',
  component: () => <ServiceRuntime view="metrics" />,
})
const serviceActivityRoute = createRoute({
  getParentRoute: () => detailRoute,
  path: 'activity',
  component: ServiceActivity,
})
const router = createRouter({
  routeTree: rootRoute.addChildren([
    indexRoute,
    environmentsRoute,
    newRoute,
    detailRoute.addChildren([
      serviceIndexRoute,
      networkingRoute,
      serviceBuildsRoute,
      serviceLogsRoute,
      serviceMetricsRoute,
      serviceConfigurationRoute,
      serviceActivityRoute,
    ]),
  ]),
  defaultPreload: 'intent',
})
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
)
