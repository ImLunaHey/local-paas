import { DatabasePanel } from './features/databases/database-connections'
import { Hosts } from './features/overview/host-dashboard'
import { RuntimePanel } from './features/deployments/runtime-panel'
import { ServiceHeader } from './features/services/service-header'
import { ServiceRow } from './features/services/service-row'

import { ServiceForm } from './features/services/service-form'
import { ErrorNotice } from './components/error-notice'

import { ContentBoundary, RouteError } from './error-boundary'
import { FileBrowser } from './file-browser'
import { BucketPanel } from './features/storage/object-storage'
import { StoragePanel } from './features/storage/storage'
import { JobsPanel } from './features/jobs/jobs'
import { CreationScope, WorkspaceBreadcrumbs } from './workspace-context'
import { DatabaseForm } from './features/databases/databases'
import { DatabaseInspector } from './features/databases/database-inspection'
import { DatabaseWorkspace } from './database-workspace'
import { ServiceWorkspace } from './service-workspace'
import { Domains } from './features/domains/domains'
import { Overview } from './features/overview/overview'
import { Nodes } from './nodes'

import { CommandMenu } from './command-menu'
import { AuditLog } from './features/audit/audit'
import { cn } from 'cn'
import { Button } from './components/button'

import { Projects, ProjectWorkspace, ProjectBackLink, ProjectSettings } from './projects'
import { SecretManager } from './features/secrets/secrets'
import { TanStackDevtools } from '@tanstack/react-devtools'
import { ReactQueryDevtoolsPanel } from '@tanstack/react-query-devtools'
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'
import { DeploymentHistory } from './history'
import { Networking } from './networking'
import { createContext, StrictMode, useContext, useState } from 'react'

import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import {
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  Outlet,
  RouterProvider,
  redirect,
  useSearch,
  useRouterState,
} from '@tanstack/react-router'
import {
  AlertCircle,
  Box,
  Building2,
  Check,
  Circle,
  CreditCard,
  Globe,
  Layers3,
  Server,
  ShieldCheck,
  Users,
} from 'lucide-react'
import { api } from './api-client'
import { serviceQuery } from './api'
import type { Event as AuditEvent } from './generated/model/event'
import type { Service } from './generated/model/service'

import './styles.css'
import { BuildPanel } from './features/builds/builds'
import { DeploymentPanel } from './features/deployments/runtime'
import { useRuntime, runtimeLabel } from './runtime-query'
import { AccountMenu, AuthShell } from './auth-shell'
import { authClient, isPlatformAdministrator } from './auth-client'
import { OrganizationSettings } from './organization'
import { PlatformAdmin } from './platform-admin'

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 5_000 } } })

function Shell() {
  const session = authClient.useSession()
  const activeOrganization = authClient.useActiveOrganization()
  const isPlatformAdmin = isPlatformAdministrator(session.data?.user.role)
  const path = useRouterState({ select: (s) => s.location.pathname })
  const navClass = (active: boolean) =>
    cn(
      'flex min-h-11 items-center gap-3 rounded-md border px-3 py-2.5 text-xs transition-colors max-[720px]:shrink-0',
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
      <aside className="sidebar max-[720px]:!grid max-[720px]:grid-cols-1 max-[720px]:gap-3">
        <Link to="/" className="brand">
          <span className="brand-mark">
            <Layers3 size={21} />
          </span>
          <span>
            local<span className="text-muted"> / </span>paas
          </span>
        </Link>
        <div className="workspace">
          <div className="workspace-icon">{isPlatformAdmin ? 'P' : 'L'}</div>
          <div>
            <strong>
              {isPlatformAdmin
                ? 'Platform administration'
                : activeOrganization.data?.name || 'Organization'}
            </strong>
            <span>
              {isPlatformAdmin
                ? 'All organizations'
                : activeOrganization.data?.slug || 'Local development'}
            </span>
          </div>
        </div>
        <div className="nav-label">{isPlatformAdmin ? 'PLATFORM' : 'WORKSPACE'}</div>
        <nav
          aria-label="Workspace navigation"
          className="flex gap-2 py-2 max-[720px]:w-full max-[720px]:flex-1 max-[720px]:!flex-nowrap max-[720px]:overflow-x-auto max-[720px]:pb-2 min-[721px]:flex-col"
        >
          {isPlatformAdmin ? (
            <>
              <Link to="/" className={navClass(path === '/')}>
                <Box size={17} />
                <span>Overview</span>
              </Link>
              <Link
                to="/platform/organizations"
                className={navClass(path === '/platform/organizations')}
              >
                <Building2 size={17} />
                <span>Organizations</span>
              </Link>
              <Link to="/platform/users" className={navClass(path === '/platform/users')}>
                <Users size={17} />
                <span>Users</span>
              </Link>
              <Link to="/platform/billing" className={navClass(path === '/platform/billing')}>
                <CreditCard size={17} />
                <span>Billing</span>
              </Link>
            </>
          ) : (
            <>
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
              <Link to="/nodes" className={navClass(path === '/nodes')}>
                <Server size={17} />
                <span>Nodes</span>
              </Link>
              <Link to="/domains" className={navClass(path === '/domains')}>
                <Globe size={17} />
                <span>Domains</span>
              </Link>
              <Link to="/audit" className={navClass(path === '/audit')}>
                <ShieldCheck size={17} />
                <span>Audit log</span>
              </Link>
              <Link to="/organization" className={navClass(path === '/organization')}>
                <ShieldCheck size={17} />
                <span>Organization</span>
              </Link>
            </>
          )}
        </nav>
        <div className="sidebar-bottom mt-auto">
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
        <AccountMenu />
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <WorkspaceBreadcrumbs />
          <span className="environment-tag">
            <span className="status-dot" /> Private platform
          </span>
          <CommandMenu />
          <AccountMenu compact />
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
      <ServiceHeader spec={spec} runtime={runtime} serviceId={serviceId} />
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
    <ServiceForm key={service.id} service={service} />
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
        <StoragePanel key={`volume:${service.id}`} service={service} />
        <BucketPanel key={`objects:${service.id}`} service={service} />
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
              <time dateTime={event.createdAt}>{new Date(event.createdAt).toLocaleString()}</time>
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
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: function Home() {
    const session = authClient.useSession()
    return isPlatformAdministrator(session.data?.user.role) ? (
      <PlatformAdmin view="overview" />
    ) : (
      <Overview />
    )
  },
})
const platformOrganizationsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/platform/organizations',
  component: () => <PlatformAdmin view="organizations" />,
})
const platformUsersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/platform/users',
  component: () => <PlatformAdmin view="users" />,
})
const platformBillingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/platform/billing',
  component: () => <PlatformAdmin view="billing" />,
})
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
const nodesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/nodes',
  component: Nodes,
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
  component: function ServiceNetworking() {
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
const organizationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/organization',
  component: OrganizationSettings,
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
  component: function ServiceJobs() {
    return <JobsPanel service={useCurrentService()} />
  },
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
  component: function ServiceDatabase() {
    return <DatabaseInspector service={useCurrentService()} />
  },
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
  component: function ServiceSecrets() {
    return <SecretManager service={useCurrentService()} />
  },
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
    platformOrganizationsRoute,
    platformUsersRoute,
    platformBillingRoute,
    projectsRoute,
    hostsRoute,
    nodesRoute,
    domainsRoute,
    projectRoute,
    projectSettingsRoute,
    auditRoute,
    organizationRoute,
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
      <AuthShell>
        <RouterProvider router={router} />
      </AuthShell>
    </QueryClientProvider>
  </StrictMode>,
)
