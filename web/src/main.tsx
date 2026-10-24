import { ServiceDomains } from './service-domains'
import { CreationSecrets, type CreationSecretsHandle } from './creation-secrets'
import { SourceUpload } from './source-upload'
import { ContentBoundary, RouteError } from './error-boundary'
import { FileBrowser } from './file-browser'
import { BucketPanel } from './object-storage'
import { StoragePanel } from './storage'
import { JobsPanel } from './jobs'
import { CreationScope, WorkspaceBreadcrumbs } from './workspace-context'
import { DatabaseForm, DatabasePanel } from './databases'
import { DatabaseInspector } from './database-inspection'
import { DatabaseWorkspace } from './database-workspace'
import { ServiceWorkspace } from './service-workspace'
import { Domains } from './domains'
import { Overview, Hosts } from './overview'
import { ServiceTrends } from './metrics'
import { CommandMenu } from './command-menu'
import { AuditLog } from './audit'
import { cn } from 'cn'
import { Button, Input, Select, Field, Textarea } from './ui'
import { Projects, ProjectWorkspace, ProjectBackLink, ProjectSettings } from './projects'
import { SecretManager } from './secrets'
import { TanStackDevtools } from '@tanstack/react-devtools'
import { ReactQueryDevtoolsPanel } from '@tanstack/react-query-devtools'
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'
import { DeploymentHistory } from './history'
import { Networking } from './networking'
import { createContext, StrictMode, useContext, useRef, useState } from 'react'
import type { FormEvent } from 'react'
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
  useSearch,
  useRouterState,
} from '@tanstack/react-router'
import {
  ArrowDownLeft,
  AlertCircle,
  Box,
  Globe,
  Check,
  ChevronRight,
  Circle,
  Layers3,
  LoaderCircle,
  Plus,
  Server,
  ShieldCheck,
  Workflow,
} from 'lucide-react'
import { api, serviceQuery, sourceLabel, sourceReference } from './api'
import type { AuditEvent, Service, ServiceSpec, SourceKind, Workload } from './api'
import './styles.css'
import { BuildPanel } from './builds'
import { DeploymentPanel, RuntimePanel, useRuntime, runtimeLabel } from './runtime'

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 5_000 } } })

function Shell() {
  const path = useRouterState({ select: (s) => s.location.pathname })
  const navClass = (active: boolean) =>
    cn(
      'flex min-h-11 items-center gap-3 rounded-md border px-3 py-2.5 text-xs transition-colors',
      active
        ? 'border-orange-400/20 bg-orange-400/10 text-orange-300'
        : 'border-transparent text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200',
    )
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
        <nav aria-label="Workspace navigation" className="flex gap-2 py-2 min-[721px]:flex-col">
          <Link to="/" className={navClass(path === '/')}>
            <Box size={17} />
            <span>Overview</span>
          </Link>
          <Link
            to="/projects"
            className={navClass(path.startsWith('/projects') || path.startsWith('/services'))}
          >
            <Layers3 size={17} />
            <span>Projects</span>
          </Link>
          <Link to="/hosts" className={navClass(path === '/hosts')}>
            <Server size={17} />
            <span>Hosts</span>
          </Link>
          <Link to="/domains" className={navClass(path === '/domains')}>
            <Globe size={17} />
            <span>Domains</span>
          </Link>
          <Link to="/audit" className={navClass(path === '/audit')}>
            <ShieldCheck size={17} />
            <span>Audit log</span>
          </Link>
        </nav>
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
            <i className={cn('status-dot', { online: health.isSuccess })} />
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
          <WorkspaceBreadcrumbs />
          <span className="environment-tag">
            <span className="status-dot" /> Private platform
          </span>
          <CommandMenu />
        </header>
        <main>
          <ContentBoundary>
            <Outlet />
            {import.meta.env.DEV && (
              <TanStackDevtools
                plugins={[
                  { name: 'TanStack Query', render: <ReactQueryDevtoolsPanel /> },
                  { name: 'TanStack Router', render: <TanStackRouterDevtoolsPanel /> },
                ]}
              />
            )}
          </ContentBoundary>
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
        <Button className="button secondary mt-3" onClick={retry}>
          Try again
        </Button>
      )}
    </div>
  )
}

function ServiceRow({ service }: { service: Service }) {
  const { spec } = service
  const runtime = useRuntime(service.id, spec.workload.kind !== 'celld-service')
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
            {spec.workload.kind === 'rustfs-service'
              ? 'RustFS · S3 storage'
              : spec.workload.kind === 'postgres-service' || spec.workload.kind === 'redis-service'
                ? `${spec.workload.kind === 'redis-service' ? 'Redis 8' : 'PostgreSQL 18'} · local volume`
                : sourceLabel(spec.source)}
          </p>
        </div>
      </div>
      <span className="text-xs text-muted">
        {spec.workload.kind === 'oci-service'
          ? spec.workload.execution === 'worker'
            ? 'Singleton background worker'
            : `${spec.workload.replicas} requested replicas`
          : spec.workload.kind === 'celld-service'
            ? `${spec.workload.members} requested members`
            : '1 pinned database'}
      </span>
      <ServiceTrends service={service} instances={runtime.data?.instances ?? []} />
      <span className="flex items-center justify-between gap-4">
        <span
          className={cn(
            'chip',
            runtimeLabel(runtime.data) === 'Running' &&
              '!border-emerald-400/20 !bg-emerald-400/10 !text-emerald-300',
          )}
        >
          <Circle size={9} />
          {spec.workload.kind === 'celld-service'
            ? 'Fleet not deployed'
            : runtime.isError
              ? 'Status unavailable'
              : runtimeLabel(runtime.data)}
        </span>
        <ChevronRight size={16} className="text-muted" />
      </span>
    </Link>
  )
}

function NewService() {
  const scope = useSearch({ strict: false }) as { project?: string; environment?: string }
  return (
    <CreationScope key={scope.project + ':' + scope.environment}>
      <CreationKind />
    </CreationScope>
  )
}

function CreationKind() {
  const scope = useSearch({ strict: false }) as { project?: string; environment?: string }
  const [kind, setKind] = useState<'app' | 'database' | 'storage' | null>(null)
  if (!kind)
    return (
      <>
        <ProjectBackLink project={scope.project} environment={scope.environment} />
        <div className="page-heading">
          <div>
            <div className="eyebrow">NEW SERVICE</div>
            <h1>What do you want to create?</h1>
            <p>Choose what to add to this project’s environment.</p>
          </div>
        </div>
        <div className="grid max-w-4xl gap-4 md:grid-cols-3">
          {(
            [
              ['app', 'App', 'Deploy an application from Git, a ZIP, or local files.', Box],
              ['database', 'Database', 'Add PostgreSQL or Redis with persistent storage.', Server],
              [
                'storage',
                'Storage',
                'Add S3-compatible object storage powered by RustFS.',
                Layers3,
              ],
            ] as const
          ).map(([value, label, description, Icon]) => (
            <Button
              key={value}
              aria-label={label}
              onClick={() => setKind(value)}
              className="min-h-48 flex-col items-start justify-start gap-4 whitespace-normal rounded-xl p-6 text-left"
            >
              <Icon size={24} className="text-accent" />
              <span className="text-base text-zinc-100">{label}</span>
              <span className="text-sm font-normal leading-relaxed text-muted">{description}</span>
            </Button>
          ))}
        </div>
      </>
    )
  return (
    <>
      <Button variant="ghost" className="mb-4" onClick={() => setKind(null)}>
        ← Change service type
      </Button>
      {kind === 'app' ? (
        <ServiceForm />
      ) : (
        <DatabaseForm initialEngine={kind === 'storage' ? 'rustfs-service' : 'postgres-service'} />
      )}
    </>
  )
}

function ServiceForm({ service }: { service?: Service }) {
  const scope = useSearch({ strict: false }) as { project?: string; environment?: string }
  const [baseline, setBaseline] = useState(service)
  const spec = baseline?.spec
  const oci = spec?.workload.kind === 'oci-service' ? spec.workload : undefined
  const celld = spec?.workload.kind === 'celld-service' ? spec.workload : undefined
  const initialRef = spec ? sourceReference(spec.source) : { kind: 'commit' as const, value: '' }
  const [sourceMode, setSourceMode] = useState<'git' | 'upload'>(
    spec?.source?.upload ? 'upload' : 'git',
  )
  const [uploadDigest, setUploadDigest] = useState(spec?.source?.upload)
  const [sourceKind, setSourceKind] = useState<SourceKind>(initialRef.kind)
  const [sourceValue, setSourceValue] = useState(initialRef.value)
  const [buildMode, setBuildMode] = useState<'auto' | 'dockerfile' | 'generated'>(
    oci?.build_mode ?? 'auto',
  )
  const [execution, setExecution] = useState<'http' | 'worker'>(oci?.execution ?? 'http')
  const [dirty, setDirty] = useState(false)
  const [domainsReady, setDomainsReady] = useState(false)
  const secretsDraft = useRef<CreationSecretsHandle>(null)
  const created = useRef<Service | null>(null)
  const [creationLocked, setCreationLocked] = useState(false)
  const [formVersion, setFormVersion] = useState(0)
  const [reloading, setReloading] = useState(false)
  const [reloadError, setReloadError] = useState<Error | null>(null)
  const navigate = useNavigate()
  const client = useQueryClient()
  const [kind, setKind] = useState<'oci-service' | 'celld-service'>(
    spec?.workload.kind === 'celld-service' ? 'celld-service' : 'oci-service',
  )
  const worker = kind === 'oci-service' && execution === 'worker'
  // Preserve the operation ID across retries of an identical submission, even
  // if a response was lost. A changed spec is a different operation.
  const pending = useRef<{ serialized: string; id: string } | null>(null)
  const mutation = useMutation({
    mutationFn: async (spec: ServiceSpec) => {
      const serialized = JSON.stringify({ spec, version: baseline?.version })
      if (!created.current && pending.current?.serialized !== serialized)
        pending.current = { serialized, id: crypto.randomUUID() }
      // Read inside the mutation; secret values never become mutation variables.
      const entries = baseline ? [] : secretsDraft.current!.read()
      const saved =
        created.current ??
        (await api<Service>(baseline ? `/services/${baseline.id}` : '/services', {
          method: baseline ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            operation_id: pending.current!.id,
            expected_version: baseline?.version,
            spec,
            ...(!baseline ? { build_on_create: false } : {}),
          }),
        }))
      if (baseline) return saved
      created.current = saved
      setCreationLocked(true)
      for (const entry of entries) {
        const { version } = await api<{ version: number }>(`/services/${saved.id}/secrets`)
        await api(`/services/${saved.id}/secrets`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: entry.name, value: entry.value, expected_version: version }),
        })
        entry.value = ''
        secretsDraft.current!.saved(entry.id)
      }
      if (saved.spec.workload.kind === 'oci-service')
        await api(`/services/${saved.id}/builds`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ operation_id: pending.current!.id }),
        })
      return saved
    },
    onSuccess: async (service) => {
      await client.invalidateQueries({ queryKey: ['services'] })
      if (baseline) {
        pending.current = null
        setBaseline(service)
        setDirty(false)
        await client.invalidateQueries({ queryKey: ['events', service.id] })
        return
      }
      await navigate({ to: '/services/$serviceId/builds', params: { serviceId: service.id } })
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
      setSourceMode(saved.spec.source?.upload ? 'upload' : 'git')
      setUploadDigest(saved.spec.source?.upload)
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
    if (created.current) {
      mutation.mutate(created.current.spec)
      return
    }
    const data = new FormData(event.currentTarget)
    const text = (key: string) => String(data.get(key) ?? '').trim()
    const number = (key: string) => Number(text(key))
    const buildArgsInput = event.currentTarget.elements.namedItem(
      'build_args',
    ) as HTMLTextAreaElement | null
    const lines = text('build_args').split('\n').filter(Boolean)
    const keys = lines.map((line) => line.slice(0, line.indexOf('=')))
    if (buildArgsInput) {
      buildArgsInput.setCustomValidity(
        lines.some((line) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(line)) ||
          new Set(keys).size !== keys.length
          ? 'Use unique NAME=value entries, one per line.'
          : '',
      )
      if (!buildArgsInput.reportValidity()) return
    }
    const workload: Workload =
      kind === 'oci-service'
        ? {
            kind,
            build_mode: buildMode,
            build_command:
              buildMode === 'dockerfile' ? undefined : text('build_command') || undefined,
            start_command:
              buildMode === 'dockerfile' ? undefined : text('start_command') || undefined,
            build_args: Object.fromEntries(
              lines.map((line) => {
                const split = line.indexOf('=')
                return [line.slice(0, split), line.slice(split + 1)]
              }),
            ),
            build_target: text('build_target') || undefined,
            pre_deploy: text('pre_deploy_executable')
              ? {
                  command: [
                    text('pre_deploy_executable'),
                    ...text('pre_deploy_arguments').split('\n').filter(Boolean),
                  ],
                  timeout_seconds: number('pre_deploy_timeout'),
                }
              : undefined,
            dockerfile: text('dockerfile'),
            context: text('context'),
            execution: worker ? 'worker' : undefined,
            replicas: worker ? 1 : number('replicas'),
            port: worker ? undefined : number('port'),
            readiness: worker
              ? undefined
              : {
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
      source:
        kind === 'oci-service' && sourceMode === 'upload'
          ? { repository: '', upload: uploadDigest }
          : { repository: text('repository'), [sourceKind]: sourceValue.trim() },
      resources: { cpu_millis: number('cpu'), memory_mib: number('memory') },
      distinct_nodes: worker ? false : data.has('distinct'),
      domains: worker ? [] : data.getAll('domains').map(String),
      secrets: spec?.secrets ?? [],
      workload,
      volume: spec?.volume,
    })
  }
  return (
    <>
      {!baseline && (
        <>
          <ProjectBackLink project={scope.project} environment={scope.environment} />
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
            <fieldset disabled={creationLocked} className="space-y-5">
              <section className="panel form-section">
                <h2>
                  <span className="step">01</span> Application
                </h2>
                <div className="grid sm:grid-cols-2 gap-3 mb-6">
                  {(['oci-service', 'celld-service'] as const).map((type) => (
                    <Button
                      type="button"
                      disabled={!!baseline}
                      aria-pressed={kind === type}
                      className={cn('kind-option', { selected: kind === type })}
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
                          {type === 'oci-service'
                            ? 'Web apps, APIs & background workers'
                            : 'Workers & Durable Objects'}
                        </small>
                      </span>
                      {kind === type && <Check size={15} className="ml-auto text-accent" />}
                    </Button>
                  ))}
                </div>
                <div className="grid sm:grid-cols-2 gap-4">
                  <input
                    type="hidden"
                    name="project"
                    value={spec?.project ?? scope.project ?? ''}
                  />
                  <input
                    type="hidden"
                    name="environment"
                    value={spec?.environment ?? scope.environment ?? ''}
                  />
                  <div className="sm:col-span-2">
                    <Field label="Service name">
                      <Input
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
                  {kind === 'oci-service' && (
                    <Field label="Deployment source">
                      <Select
                        value={sourceMode}
                        onChange={(e) => {
                          setSourceMode(e.target.value as 'git' | 'upload')
                          setDirty(true)
                        }}
                      >
                        <option value="git">Git repository</option>
                        <option value="upload">ZIP or local files</option>
                      </Select>
                    </Field>
                  )}
                  {kind === 'oci-service' && sourceMode === 'upload' ? (
                    <SourceUpload
                      project={spec?.project ?? scope.project ?? ''}
                      digest={uploadDigest}
                      onChange={(digest) => {
                        setUploadDigest(digest)
                        setDirty(true)
                      }}
                    />
                  ) : (
                    <>
                      <Field
                        label="Git repository"
                        hint="An HTTPS URL without a token or embedded credentials."
                      >
                        <Input
                          name="repository"
                          defaultValue={spec?.source?.repository}
                          type="url"
                          placeholder="https://github.com/you/your-app.git"
                          required
                          maxLength={2048}
                        />
                      </Field>
                      <Field label="Source type">
                        <Select
                          className="build-select"
                          value={sourceKind}
                          onChange={(event) => setSourceKind(event.target.value as SourceKind)}
                        >
                          <option value="branch">Branch</option>
                          <option value="tag">Tag</option>
                          <option value="commit">Commit</option>
                        </Select>
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
                        <Input
                          name="source_ref"
                          className="font-mono"
                          value={sourceValue}
                          onChange={(event) => setSourceValue(event.target.value)}
                          required
                          pattern={
                            sourceKind === 'commit' ? '([a-f0-9]{40}|[a-f0-9]{64})' : undefined
                          }
                        />
                      </Field>
                    </>
                  )}
                  {kind === 'oci-service' ? (
                    <>
                      <Field
                        label="Build method"
                        hint="Automatic uses your Dockerfile when present, otherwise generates one for a supported Node or Bun app with a lockfile and start script or custom start command."
                      >
                        <Select
                          name="build_mode"
                          className="build-select"
                          value={buildMode}
                          onChange={(event) => setBuildMode(event.target.value as typeof buildMode)}
                        >
                          <option value="auto">Automatic (Dockerfile or language detection)</option>
                          <option value="dockerfile">Repository Dockerfile only</option>
                          <option value="generated">Generate Dockerfile from app</option>
                        </Select>
                      </Field>
                      {buildMode !== 'dockerfile' && (
                        <>
                          <Field
                            label="Build command (optional)"
                            hint="Blank uses scripts.build when present. A custom command selects a generated Dockerfile, even if the repository has one. Commands run inside the builder; use secret references for secrets."
                          >
                            <Input
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
                            <Input
                              name="start_command"
                              defaultValue={oci?.start_command}
                              placeholder="npm start"
                              maxLength={4096}
                            />
                          </Field>
                        </>
                      )}
                      <Field
                        label="Dockerfile target (optional)"
                        hint="Build a named stage, such as api or production. Requires a repository Dockerfile."
                      >
                        <Input
                          name="build_target"
                          defaultValue={oci?.build_target}
                          placeholder="production"
                          maxLength={128}
                        />
                      </Field>
                      <Field
                        label="Build arguments (optional)"
                        hint="One NAME=value per line. These are public build configuration and may appear in image metadata and build logs. Never enter secrets here."
                      >
                        <Textarea
                          onChange={(e) => e.currentTarget.setCustomValidity('')}
                          name="build_args"
                          defaultValue={Object.entries(oci?.build_args ?? {})
                            .map(([k, v]) => `${k}=${v}`)
                            .join('\n')}
                          placeholder="BINARY=api"
                          rows={3}
                          maxLength={20000}
                        />
                      </Field>
                      <div className="grid sm:grid-cols-2 gap-4">
                        <Field label="Dockerfile path">
                          <Input
                            name="dockerfile"
                            defaultValue={oci?.dockerfile ?? 'Dockerfile'}
                            required
                          />
                        </Field>
                        <Field label="Build context">
                          <Input name="context" defaultValue={oci?.context ?? '.'} required />
                        </Field>
                      </div>
                    </>
                  ) : (
                    <>
                      <Field label="Wrangler configuration">
                        <Input
                          name="wrangler"
                          defaultValue={celld?.wrangler ?? 'wrangler.jsonc'}
                          required
                        />
                      </Field>
                      <Field
                        label="Bucket configuration reference"
                        hint="A dedicated fleet's storage reference. Do not enter credentials."
                      >
                        <Input
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
                    <Input
                      name="cpu"
                      type="number"
                      defaultValue={spec?.resources.cpu_millis ?? 500}
                      min={1}
                      max={64000}
                      required
                    />
                  </Field>
                  <Field label="Memory per instance (MiB)">
                    <Input
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
                      <div className="sm:col-span-2 rounded-md border border-zinc-800 p-4 space-y-4">
                        <h3 className="text-sm">Pre-deploy command</h3>
                        <p className="text-xs text-muted">
                          Run a migration or release task from the candidate image before starting
                          new instances. A failed task leaves the current app running. Database
                          changes must remain compatible with the old app; they are not
                          automatically rolled back.
                        </p>
                        <Field
                          label="Pre-deploy executable (optional)"
                          hint="An executable inside your image. Leave blank to disable. Arguments are passed literally, without shell parsing."
                        >
                          <Input
                            name="pre_deploy_executable"
                            defaultValue={oci?.pre_deploy?.command[0]}
                            placeholder="bun"
                            maxLength={4096}
                          />
                        </Field>
                        <Field
                          label="Pre-deploy arguments"
                          hint="One argument per line. For bun run db:migrate, enter run and db:migrate on separate lines. Use OpenBao for secrets."
                        >
                          <Textarea
                            name="pre_deploy_arguments"
                            defaultValue={oci?.pre_deploy?.command.slice(1).join('\n')}
                            placeholder={'run\ndb:migrate'}
                            maxLength={16384}
                            rows={3}
                          />
                        </Field>
                        <Field label="Pre-deploy time limit (seconds)">
                          <Input
                            name="pre_deploy_timeout"
                            type="number"
                            min={10}
                            max={86400}
                            defaultValue={oci?.pre_deploy?.timeout_seconds ?? 300}
                            required
                          />
                        </Field>
                      </div>
                      <Field
                        label="Process type"
                        hint={
                          baseline
                            ? 'Process type is fixed when the service is created.'
                            : 'Workers run continuously without receiving HTTP requests.'
                        }
                        className="sm:col-span-2"
                      >
                        <Select
                          name="execution"
                          value={execution}
                          disabled={!!baseline}
                          onChange={(e) => {
                            setExecution(e.target.value as 'http' | 'worker')
                            setDirty(true)
                          }}
                        >
                          <option value="http">Web application / API</option>
                          <option value="worker">Background worker · singleton</option>
                        </Select>
                      </Field>
                      {worker ? (
                        <p className="sm:col-span-2 text-sm text-muted">
                          One running instance. Deployments stop the previous instance and wait for
                          confirmed shutdown before starting its replacement. A running process is
                          observed for 10 seconds; this does not verify application progress.
                        </p>
                      ) : (
                        <>
                          <Field label="Replicas">
                            <Input
                              name="replicas"
                              type="number"
                              defaultValue={oci?.replicas ?? 2}
                              min={1}
                              max={32}
                              required
                            />
                          </Field>
                          <Field label="HTTP port">
                            <Input
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
                              <Input
                                name="readiness"
                                defaultValue={oci?.readiness?.path ?? '/health'}
                                required
                              />
                            </Field>
                          </div>
                          <Field label="Check interval (seconds)">
                            <Input
                              name="interval"
                              type="number"
                              defaultValue={oci?.readiness?.interval_seconds ?? 10}
                              min={1}
                              max={300}
                              required
                            />
                          </Field>
                          <Field label="Stabilization period (seconds)">
                            <Input
                              name="stabilization"
                              type="number"
                              defaultValue={oci?.readiness?.stabilization_seconds ?? 30}
                              min={1}
                              max={3600}
                              required
                            />
                          </Field>
                        </>
                      )}
                    </>
                  ) : (
                    <Field label="Fleet members">
                      <Input
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
                {!worker && (
                  <label className="checkbox-field">
                    <Input
                      type="checkbox"
                      name="distinct"
                      defaultChecked={spec?.distinct_nodes ?? true}
                    />
                    <span>
                      Spread across distinct nodes
                      <small>Different VMs on Lake still share one physical failure domain.</small>
                    </span>
                  </label>
                )}
              </section>
              <section className="panel form-section">
                <h2>
                  <span className="step">04</span> Domains
                </h2>
                <div className="space-y-4">
                  {worker ? (
                    <p className="text-sm text-muted">
                      Background workers do not accept inbound HTTP traffic or domain mappings.
                    </p>
                  ) : (
                    <ServiceDomains
                      serviceId={baseline?.id}
                      onChange={() => setDirty(true)}
                      onReadyChange={setDomainsReady}
                    />
                  )}
                </div>
              </section>
            </fieldset>
            <section className="panel form-section">
              <h2>
                <span className="step">05</span> Secrets
              </h2>
              <div className="space-y-4">
                {baseline ? (
                  <Link
                    to="/services/$serviceId/secrets"
                    params={{ serviceId: baseline.id }}
                    className="button secondary"
                  >
                    Manage secrets in OpenBao
                  </Link>
                ) : (
                  <CreationSecrets ref={secretsDraft} locked={creationLocked} />
                )}
              </div>
            </section>
            {baseline && mutation.isSuccess && !dirty && (
              <p role="status" className="text-sm text-accent">
                Configuration saved.
              </p>
            )}
            {creationLocked && mutation.isError && (
              <p role="status" className="text-sm text-muted">
                Your service is saved. Retry to finish saving secrets and start its build.
              </p>
            )}
            {reloadError && <ErrorNotice error={reloadError} />}
            {mutation.isError && <ErrorNotice error={mutation.error} />}
            <div className="flex items-center justify-between gap-3">
              {baseline ? (
                <Button
                  type="button"
                  className="button secondary"
                  onClick={() => {
                    void reloadSaved()
                  }}
                >
                  Reload saved configuration
                </Button>
              ) : (
                <Link to="/" className="button secondary">
                  Cancel
                </Link>
              )}
              <Button
                type="submit"
                className="button primary"
                disabled={
                  (!worker && !domainsReady) ||
                  mutation.isPending ||
                  (!!baseline && !dirty) ||
                  (kind === 'oci-service' && sourceMode === 'upload' && !uploadDigest)
                }
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
                    : creationLocked
                      ? 'Retry creation'
                      : kind === 'oci-service'
                        ? 'Create and build'
                        : 'Create service'}
              </Button>
            </div>
          </fieldset>
        </form>
        <aside className="form-aside">
          <span className="service-icon mb-5">
            <ArrowDownLeft size={22} />
          </span>
          <h3>{baseline ? 'Configure your service.' : 'A specification, then a deployment.'}</h3>
          <p>
            {baseline
              ? 'Changes apply to future builds. Existing builds and image revisions keep their recorded configuration. Saving does not start a build or deploy a workload.'
              : 'Create your service, save its secrets in OpenBao, and start its first build.'}
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
            Secrets stay out of images and build logs.
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
  const database =
    spec.workload.kind === 'postgres-service' || spec.workload.kind === 'redis-service'
  if (database)
    return (
      <CurrentService.Provider value={service.data}>
        <DatabaseWorkspace
          service={service.data}
          status={runtime.isError ? 'Status unavailable' : runtimeLabel(runtime.data)}
        >
          <Outlet />
        </DatabaseWorkspace>
      </CurrentService.Provider>
    )
  return (
    <>
      <ProjectBackLink project={spec.project} environment={spec.environment} />
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            {spec.project} / {spec.environment}
          </div>
          <h1>{spec.name}</h1>
          <p>
            {spec.workload.kind === 'oci-service'
              ? spec.workload.execution === 'worker'
                ? 'Background worker · singleton'
                : 'Dockerfile service'
              : spec.workload.kind === 'postgres-service' || spec.workload.kind === 'redis-service'
                ? spec.workload.kind === 'redis-service'
                  ? 'Redis database'
                  : 'PostgreSQL database'
                : spec.workload.kind === 'rustfs-service'
                  ? 'RustFS S3 storage'
                  : 'Dedicated celld application fleet'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {spec.workload.kind === 'oci-service' &&
          spec.workload.execution === 'worker' ? null : runtime.data?.preview_url ? (
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
              {spec.workload.kind === 'postgres-service' || spec.workload.kind === 'redis-service'
                ? 'Database connections'
                : 'Set up URL'}
            </Link>
          )}
          <span
            className={cn(
              'chip',
              !runtime.isError &&
                runtimeLabel(runtime.data) === 'Running' &&
                '!border-emerald-400/20 !bg-emerald-400/10 !text-emerald-300',
            )}
          >
            <Circle size={10} />
            {runtime.isError ? 'Runtime status unavailable' : runtimeLabel(runtime.data)}
          </span>
        </div>
      </div>
      <CurrentService.Provider value={service.data}>
        <ServiceWorkspace service={service.data}>
          <Outlet />
        </ServiceWorkspace>
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
  return service.spec.workload.kind === 'oci-service' ||
    service.spec.workload.kind === 'celld-service' ? (
    <ServiceForm key={service.id + ':' + service.version} service={service} />
  ) : (
    <DatabaseForm key={service.id} service={service} />
  )
}
function ServiceStorage() {
  const service = useCurrentService()
  const search = useSearch({ strict: false }) as { browse?: 'objects' | 'volume' }
  if (search.browse && service.spec.workload.kind === 'oci-service')
    return <FileBrowser service={service} kind={search.browse} />
  if (service.spec.workload.kind === 'oci-service')
    return (
      <>
        <StoragePanel key={service.id + ':' + service.version} service={service} />
        <BucketPanel key={service.id} service={service} />
      </>
    )
  if (service.spec.workload.kind === 'rustfs-service') return <BucketPanel service={service} />
  return (
    <section className="panel p-6">
      <h2>Managed storage</h2>
      <p className="text-sm text-muted mt-3">
        {service.spec.workload.kind === 'celld-service'
          ? 'Durable state is managed by the dedicated celld fleet.'
          : 'The database owns its persistent volume. Use database connections and engine-aware exports to access its data.'}
      </p>
    </section>
  )
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
      <DeploymentHistory serviceId={service.id} />
      <h3 className="my-6 text-sm">Events</h3>
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
const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: Overview })
const projectsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/projects',
  component: Projects,
})
const hostsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/hosts',
  component: Hosts,
})
const domainsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/domains',
  component: Domains,
})
const environmentsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/environments',
  beforeLoad: () => {
    throw redirect({ to: '/' })
  },
})
const networkingRoute = createRoute({
  getParentRoute: () => detailRoute,
  path: 'networking',
  component: () => {
    const service = useCurrentService()
    if (service.spec.workload.kind === 'rustfs-service')
      return (
        <section className="panel p-6">
          <h2>Private S3 endpoint</h2>
          <p className="text-sm text-muted mt-3">
            Attach buckets to apps from their Storage tab. Public S3 routing is not enabled.
          </p>
        </section>
      )
    return service.spec.workload.kind === 'postgres-service' ||
      service.spec.workload.kind === 'redis-service' ? (
      <DatabasePanel service={service} />
    ) : (
      <Networking service={service} />
    )
  },
})
const auditRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/audit',
  component: AuditLog,
})
const projectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/projects/$projectId',
  validateSearch: (s: Record<string, unknown>): { environment?: string } => ({
    environment: typeof s.environment === 'string' ? s.environment : undefined,
  }),
  component: () => (
    <ProjectWorkspace
      renderService={(service) => <ServiceRow key={service.id} service={service} />}
    />
  ),
})
const projectSettingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/projects/$projectId/settings',
  component: ProjectSettings,
})
const newRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/services/new',
  validateSearch: (s: Record<string, unknown>): { project?: string; environment?: string } => ({
    project: typeof s.project === 'string' ? s.project : undefined,
    environment: typeof s.environment === 'string' ? s.environment : undefined,
  }),
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
  beforeLoad: async ({ params, location }) => {
    const service = await queryClient.ensureQueryData(serviceQuery(params.serviceId))
    const to =
      location.hash === 'configuration'
        ? '/services/$serviceId/configuration'
        : location.hash === 'activity'
          ? '/services/$serviceId/activity'
          : !location.hash &&
              (service.spec.workload.kind === 'postgres-service' ||
                service.spec.workload.kind === 'redis-service')
            ? '/services/$serviceId/overview'
            : '/services/$serviceId/builds'
    throw redirect({ to, params, replace: true, hash: '' })
  },
})
const serviceSetupRoute = createRoute({
  getParentRoute: () => detailRoute,
  path: 'setup',
  beforeLoad: ({ params }) => {
    throw redirect({ to: '/services/$serviceId/secrets', params, replace: true })
  },
})
const serviceBuildsRoute = createRoute({
  getParentRoute: () => detailRoute,
  path: 'builds',
  component: ServiceBuilds,
})
const serviceJobsRoute = createRoute({
  getParentRoute: () => detailRoute,
  path: 'jobs',
  component: () => <JobsPanel service={useCurrentService()} />,
})
const serviceDatabaseRoute = createRoute({
  getParentRoute: () => detailRoute,
  path: 'overview',
  validateSearch: (s: Record<string, unknown>): { table?: number } => ({
    table:
      Number.isSafeInteger(Number(s.table)) && Number(s.table) > 0 && Number(s.table) <= 4294967295
        ? Number(s.table)
        : undefined,
  }),
  component: () => <DatabaseInspector service={useCurrentService()} />,
})
const serviceConfigurationRoute = createRoute({
  getParentRoute: () => detailRoute,
  path: 'configuration',
  component: ServiceConfiguration,
})
const serviceStorageRoute = createRoute({
  getParentRoute: () => detailRoute,
  path: 'storage',
  validateSearch: (
    search: Record<string, unknown>,
  ): { browse?: 'objects' | 'volume'; path?: string } => ({
    browse: search.browse === 'objects' || search.browse === 'volume' ? search.browse : undefined,
    path: typeof search.path === 'string' ? search.path : undefined,
  }),
  component: ServiceStorage,
})
const serviceSecretsRoute = createRoute({
  getParentRoute: () => detailRoute,
  path: 'secrets',
  component: () => <SecretManager service={useCurrentService()} />,
})
const serviceLogsRoute = createRoute({
  getParentRoute: () => detailRoute,
  path: 'logs',
  validateSearch: (search: Record<string, unknown>): { instance?: string } => ({
    instance:
      typeof search.instance === 'string' && /^[0-9a-f-]{36}$/i.test(search.instance)
        ? search.instance
        : undefined,
  }),
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
  defaultErrorComponent: RouteError,
  routeTree: rootRoute.addChildren([
    indexRoute,
    projectsRoute,
    hostsRoute,
    domainsRoute,
    projectRoute,
    projectSettingsRoute,
    auditRoute,
    environmentsRoute,
    newRoute,
    detailRoute.addChildren([
      serviceIndexRoute,
      serviceSetupRoute,
      networkingRoute,
      serviceBuildsRoute,
      serviceJobsRoute,
      serviceDatabaseRoute,
      serviceLogsRoute,
      serviceSecretsRoute,
      serviceStorageRoute,
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
