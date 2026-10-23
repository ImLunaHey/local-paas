import { StrictMode, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
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
  useNavigate,
} from '@tanstack/react-router'
import {
  ArrowDownLeft,
  ArrowLeft,
  ArrowRight,
  Box,
  Check,
  ChevronRight,
  Circle,
  Code2,
  GitCommitHorizontal,
  Layers3,
  LoaderCircle,
  Plus,
  Radio,
  Server,
  ShieldCheck,
  Terminal,
  Workflow,
} from 'lucide-react'
import { api, serviceQuery } from './api'
import type { AuditEvent, Service, ServiceSpec, Workload } from './api'
import './styles.css'

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
            <span className="status-dot" /> Development
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
  const services = useQuery({
    queryKey: ['services', { offset }],
    queryFn: () => api<{ items: Service[]; total: number }>(`/services?offset=${offset}`),
  })
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">APPLICATION PLATFORM</div>
          <h1>A place for your services.</h1>
          <p>From a repository to infrastructure you own.</p>
        </div>
        <Link className="button primary" to="/services/new">
          <Plus size={17} />
          Register service
        </Link>
      </div>
      <div className="phase-banner">
        <span className="phase-icon">
          <Terminal size={19} />
        </span>
        <div>
          <strong>The foundation is taking shape.</strong>
          <p>
            Register your applications here. Builds, workers, and deployments are the next step.
          </p>
        </div>
        <span className="chip ml-auto">Phase 1 · Foundation</span>
      </div>
      <div className="grid sm:grid-cols-3 gap-4 mt-7 mb-9">
        <Metric
          icon={<Box size={17} />}
          label="Registered services"
          value={services.data ? String(services.data.total) : '—'}
          detail="Specifications saved in PostgreSQL"
        />
        <Metric
          icon={<Server size={17} />}
          label="Worker nodes"
          value="Not connected"
          detail="Target: three VMs · one physical host"
        />
        <Metric
          icon={<Radio size={17} />}
          label="Deployments"
          value="Not enabled"
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
            resources, and health-gated releases.
          </p>
          <div className="pipeline">
            <span>Repository</span>
            <ArrowRight size={12} />
            <span>BuildKit</span>
            <ArrowRight size={12} />
            <span>Container</span>
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
            {spec.source.commit.slice(0, 8)}
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

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  )
}

function NewService() {
  const navigate = useNavigate()
  const client = useQueryClient()
  const [kind, setKind] = useState<Workload['kind']>('oci-service')
  // Preserve the operation ID across retries of an identical submission, even
  // if a response was lost. A changed spec is a different operation.
  const pending = useRef<{ serialized: string; id: string } | null>(null)
  const mutation = useMutation({
    mutationFn: async (spec: ServiceSpec) => {
      const serialized = JSON.stringify(spec)
      if (pending.current?.serialized !== serialized)
        pending.current = { serialized, id: crypto.randomUUID() }
      return api<Service>('/services', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operation_id: pending.current.id, spec }),
      })
    },
    onSuccess: async (service) => {
      await client.invalidateQueries({ queryKey: ['services'] })
      await navigate({ to: '/services/$serviceId', params: { serviceId: service.id } })
    },
  })
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
      source: { repository: text('repository'), commit: text('commit') },
      resources: { cpu_millis: number('cpu'), memory_mib: number('memory') },
      distinct_nodes: data.has('distinct'),
      domains: list('domains'),
      secrets: list('secrets'),
      workload,
    })
  }
  return (
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
      <div className="form-layout">
        <form onSubmit={submit} className="space-y-5">
          <fieldset disabled={mutation.isPending} className="space-y-5">
            <section className="panel form-section">
              <h2>
                <span className="step">01</span> Application
              </h2>
              <div className="grid sm:grid-cols-2 gap-3 mb-6">
                {(['oci-service', 'celld-service'] as const).map((type) => (
                  <button
                    type="button"
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
                    placeholder="personal"
                    required
                    pattern="[a-z0-9]+(-[a-z0-9]+)*"
                    maxLength={63}
                  />
                </Field>
                <Field label="Environment">
                  <input
                    name="environment"
                    defaultValue="development"
                    required
                    pattern="[a-z0-9]+(-[a-z0-9]+)*"
                    maxLength={63}
                  />
                </Field>
                <div className="sm:col-span-2">
                  <Field label="Service name">
                    <input
                      name="name"
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
                    type="url"
                    placeholder="https://github.com/you/your-app.git"
                    required
                    maxLength={2048}
                  />
                </Field>
                <Field
                  label="Commit SHA"
                  hint="A full 40- or 64-character commit hash. Branch names are not accepted."
                >
                  <input
                    name="commit"
                    className="font-mono"
                    placeholder="Full commit hash"
                    required
                    pattern="([a-f0-9]{40}|[a-f0-9]{64})"
                  />
                </Field>
                {kind === 'oci-service' ? (
                  <div className="grid sm:grid-cols-2 gap-4">
                    <Field label="Dockerfile path">
                      <input name="dockerfile" defaultValue="Dockerfile" required />
                    </Field>
                    <Field label="Build context">
                      <input name="context" defaultValue="." required />
                    </Field>
                  </div>
                ) : (
                  <>
                    <Field label="Wrangler configuration">
                      <input name="wrangler" defaultValue="wrangler.jsonc" required />
                    </Field>
                    <Field
                      label="Bucket configuration reference"
                      hint="A dedicated fleet's storage reference. Do not enter credentials."
                    >
                      <input
                        name="bucket"
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
                  <input name="cpu" type="number" defaultValue={500} min={1} max={64000} required />
                </Field>
                <Field label="Memory per instance (MiB)">
                  <input
                    name="memory"
                    type="number"
                    defaultValue={512}
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
                        defaultValue={2}
                        min={1}
                        max={32}
                        required
                      />
                    </Field>
                    <Field label="HTTP port">
                      <input
                        name="port"
                        type="number"
                        defaultValue={3000}
                        min={1}
                        max={65535}
                        required
                      />
                    </Field>
                    <div className="sm:col-span-2">
                      <Field label="Readiness path">
                        <input name="readiness" defaultValue="/health" required />
                      </Field>
                    </div>
                    <Field label="Check interval (seconds)">
                      <input
                        name="interval"
                        type="number"
                        defaultValue={10}
                        min={1}
                        max={300}
                        required
                      />
                    </Field>
                    <Field label="Stabilization period (seconds)">
                      <input
                        name="stabilization"
                        type="number"
                        defaultValue={30}
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
                      defaultValue={3}
                      min={2}
                      max={32}
                      required
                    />
                  </Field>
                )}
              </div>
              <label className="checkbox-field">
                <input type="checkbox" name="distinct" defaultChecked />
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
                  <input name="domains" placeholder="api.example.com" />
                </Field>
                <Field
                  label="Secret names (optional)"
                  hint="Names only, separated by commas. Values belong in OpenBao."
                >
                  <input name="secrets" placeholder="DATABASE_URL, SESSION_SECRET" />
                </Field>
              </div>
            </section>
            {mutation.isError && <ErrorNotice error={mutation.error} />}
            <div className="flex items-center justify-between gap-3">
              <Link to="/" className="button secondary">
                Cancel
              </Link>
              <button type="submit" className="button primary" disabled={mutation.isPending}>
                {mutation.isPending ? (
                  <LoaderCircle className="animate-spin" size={16} />
                ) : (
                  <Plus size={16} />
                )}
                {mutation.isPending ? 'Registering…' : 'Register service'}
              </button>
            </div>
          </fieldset>
        </form>
        <aside className="form-aside">
          <span className="service-icon mb-5">
            <ArrowDownLeft size={22} />
          </span>
          <h3>A specification, then a deployment.</h3>
          <p>
            This step saves the desired configuration and an audit event. It does not fetch your
            repository or start a workload.
          </p>
          <div className="aside-divider" />
          <h4>What happens next?</h4>
          <p>
            {kind === 'oci-service'
              ? 'The build pipeline will turn this commit and Dockerfile into an immutable OCI image before scheduling instances.'
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

function ServiceDetail() {
  const { serviceId } = detailRoute.useParams()
  const service = useQuery(serviceQuery(serviceId))
  const events = useQuery({
    queryKey: ['events', serviceId],
    queryFn: () => api<AuditEvent[]>(`/services/${serviceId}/events`),
  })
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
        <span className="chip">
          <Circle size={10} />
          Registered · not deployed
        </span>
      </div>
      <div className="phase-banner">
        <span className="phase-icon">
          <Check size={19} />
        </span>
        <div>
          <strong>Configuration saved.</strong>
          <p>This service has no build, revision, running instances, or public routes yet.</p>
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
      <div className="grid lg:grid-cols-[1.4fr_1fr] gap-6">
        <section className="panel p-6 min-w-0">
          <h2 className="mb-5">Service specification</h2>
          <p className="text-xs text-muted mb-4 flex items-center gap-2">
            <GitCommitHorizontal size={16} />
            {spec.source.commit.slice(0, 12)}
            <span>·</span>Schema v{spec.schema_version}
          </p>
          <pre className="spec-preview">{JSON.stringify(spec, null, 2)}</pre>
        </section>
        <section className="panel p-6 self-start">
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
                <span className="activity-dot">
                  <Check size={13} />
                </span>
                <div>
                  <h3>{event.kind === 'service.registered' ? 'Service registered' : event.kind}</h3>
                  <p>Desired configuration saved.</p>
                  <time dateTime={event.created_at}>
                    {new Date(event.created_at).toLocaleString()}
                  </time>
                </div>
              </div>
            ))
          )}
          <div className="aside-divider" />
          <p className="text-xs text-muted break-all">
            Service ID
            <br />
            <span className="font-mono">{service.data.id}</span>
          </p>
        </section>
      </div>
    </>
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
const router = createRouter({
  routeTree: rootRoute.addChildren([indexRoute, newRoute, detailRoute]),
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
