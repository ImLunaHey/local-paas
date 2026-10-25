import { ScalingPanel } from './scaling'
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
import { PlatformAdmin, PlatformUserDetail } from './platform-admin'
import { DocsSite, MarketingHome } from './public-site'

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 5_000 } } })

function Shell() {
  const session = authClient.useSession()
  const activeOrganization = authClient.useActiveOrganization()
  const isPlatformAdmin = isPlatformAdministrator(session.data?.user.role)
  const overview = useQuery({
    queryKey: ['overview', activeOrganization.data?.id],
    queryFn: () => api<{ summary: { totalNodes: number } }>('/overview'),
    enabled: !isPlatformAdmin,
  })
  const hasOrganizationNodes = (overview.data?.summary?.totalNodes ?? 0) > 0
  const path = useRouterState({ select: (s) => s.location.pathname })
  const navClass = (active: boolean) =>
    cn(
      'flex min-h-11 items-center gap-3 rounded-md border px-3 py-2.5 text-xs transition-colors max-[720px]:shrink-0',
      active
        ? 'border-orange-400/20 bg-orange-400/10 text-orange-300'
        : 'border-transparent text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200',
    )
  return (
    <div className="min-h-screen [&_section[id]]:[scroll-margin-top:24px] [&_main]:[max-width:1440px] [&_main]:[width:100%] [&_main]:[margin:0_auto] [&_main]:[padding:34px_42px_48px] [&_main]:[flex:1] [&_footer]:[border-top:1px_solid_light-dark(#e4e4e7,_#28282c)] [&_footer]:[margin:0_42px] [&_footer]:[padding:19px_0] [&_footer]:[color:light-dark(#52525b,_#8d8d95)] [&_footer]:[font-size:10px] [&_footer]:[display:flex] [&_footer]:[justify-content:space-between] [&_footer_>_span]:[color:light-dark(#52525b,_#a0a0a8)] [&_h1]:[font-size:clamp(24px,_2.5vw,_30px)] [&_h1]:[font-weight:500] [&_h1]:[line-height:1.2] [&_h1]:[letter-spacing:-1.15px] [&_h1]:[overflow-wrap:anywhere] [&_h2]:[font-size:14px] [&_h2]:[font-weight:500] [&_h2]:[letter-spacing:-0.15px] [&_h3]:[font-size:12px] [&_h3]:[font-weight:500] min-[1600px]:[&_main]:[padding-top:55px] max-[1100px]:[&_main]:[padding:32px_26px] max-[1100px]:[&_footer]:[margin:0_26px] max-[720px]:[&_main]:[padding:30px_20px] max-[720px]:[&_footer]:[margin:0_20px] max-[720px]:[&_footer]:[font-size:9px] max-[720px]:[&_h1]:[font-size:27px]">
      <aside className="sidebar max-[720px]:!grid max-[720px]:grid-cols-1 max-[720px]:gap-3 [width:212px] [position:fixed] [inset:0_auto_0_0] [background:light-dark(#fafafa,_#0e0e0f)] [border-right:1px_solid_light-dark(#e4e4e7,_#28282c)] [display:flex] [flex-direction:column] [padding:24px_16px_20px] max-[1100px]:[width:205px] max-[1100px]:[padding-left:15px] max-[1100px]:[padding-right:15px] max-[720px]:[width:auto] max-[720px]:[position:static] max-[720px]:[padding:16px_20px] max-[720px]:[border-right:0] max-[720px]:[border-bottom:1px_solid_light-dark(#e4e4e7,_#28282c)] max-[720px]:[flex-direction:row] max-[720px]:[justify-content:space-between] max-[720px]:[align-items:center] max-[720px]:[&_.workspace]:[display:none] max-[720px]:[&_nav]:[flex-wrap:wrap]">
        <Link
          to="/app"
          className="brand [display:flex] [align-items:center] [gap:11px] [font-size:18px] [font-weight:650] [letter-spacing:-0.9px] [margin:0_8px_28px] max-[720px]:[margin:0] max-[720px]:[font-size:19px]"
        >
          <span className="brand-mark [width:34px] [height:34px] [display:grid] [place-items:center] [color:light-dark(#27272a,_#ececef)] [border:1px_solid_light-dark(#d4d4d8,_#38383c)] [border-radius:9px] [background:linear-gradient(145deg,_light-dark(#d4d4d8,_#2b2b2f),_light-dark(#f4f4f5,_#18181b))]">
            <Layers3 size={21} />
          </span>
          <span>
            local<span className="text-muted"> / </span>paas
          </span>
        </Link>
        <div className="workspace [display:flex] [align-items:center] [gap:9px] [padding:12px_10px] [border:1px_solid_light-dark(#e4e4e7,_#28282c)] [border-radius:7px] [margin-bottom:26px] [&_strong]:[display:block] [&_strong]:[font-size:11px] [&_strong]:[font-weight:500] [&_span]:[display:block] [&_span]:[font-size:10px] [&_span]:[color:light-dark(#52525b,_#a0a0a8)] [&_span]:[margin-top:3px]">
          <div className="workspace-icon [width:28px] [height:29px] [border-radius:5px] [background:light-dark(#e4e4e7,_#252527)] [display:grid] [place-items:center] [font-size:12px]">
            {isPlatformAdmin ? 'P' : 'L'}
          </div>
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
        <div className="nav-label [font-size:9px] [letter-spacing:1.1px] [font-weight:600] [color:light-dark(#52525b,_#a0a0a8)] [margin:0_12px_12px] max-[720px]:[display:none]">
          {isPlatformAdmin ? 'PLATFORM' : 'WORKSPACE'}
        </div>
        <nav
          aria-label="Workspace navigation"
          className="flex gap-2 py-2 max-[720px]:w-full max-[720px]:flex-1 max-[720px]:!flex-nowrap max-[720px]:overflow-x-auto max-[720px]:pb-2 min-[721px]:flex-col"
        >
          {isPlatformAdmin ? (
            <>
              <Link to="/app" className={navClass(path === '/app')}>
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
              <Link to="/platform/users" className={navClass(path.startsWith('/platform/users'))}>
                <Users size={17} />
                <span>Users</span>
              </Link>
              <Link to="/platform/host" className={navClass(path === '/platform/host')}>
                <Server size={17} />
                <span>Host</span>
              </Link>
              <Link to="/platform/billing" className={navClass(path === '/platform/billing')}>
                <CreditCard size={17} />
                <span>Billing</span>
              </Link>
            </>
          ) : (
            <>
              <Link to="/app" className={navClass(path === '/app')}>
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
              {hasOrganizationNodes && (
                <Link to="/nodes" className={navClass(path === '/nodes')}>
                  <Server size={17} />
                  <span>Hardware</span>
                </Link>
              )}
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
        <AccountMenu />
      </aside>
      <div className="main-shell [margin-left:212px] [min-height:100vh] [display:flex] [flex-direction:column] max-[1100px]:[margin-left:205px] max-[720px]:[margin-left:0]">
        <header className="topbar [min-height:62px] [border-bottom:1px_solid_light-dark(#e4e4e7,_#28282c)] [padding:0_42px] [display:flex] [align-items:center] [justify-content:space-between] [font-size:11px] [gap:12px] [height:auto] [padding-top:10px] [padding-bottom:10px] [flex-wrap:wrap] max-[1100px]:[padding:0_26px] max-[720px]:[min-height:54px] max-[720px]:[padding:0_20px] max-[720px]:[&_.environment-tag]:[display:none]">
          <WorkspaceBreadcrumbs />
          <span className="environment-tag [border:1px_solid_light-dark(#e4e4e7,_#28282c)] [border-radius:5px] [padding:6px_9px] [display:flex] [align-items:center] [gap:7px] [color:light-dark(#27272a,_#c3c3ca)] [font-size:10px]">
            <span className="status-dot [width:5px] [height:5px] [display:inline-block] [border-radius:50%] [background:light-dark(#52525b,_#8d8d95)] [&.online]:[background:#86c897] [&.online]:[box-shadow:0_0_7px_#86c89725]" />{' '}
            Private platform
          </span>
          <CommandMenu
            showInfrastructure={Boolean(isPlatformAdmin) || hasOrganizationNodes}
            platformAdministrator={Boolean(isPlatformAdmin)}
          />
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
        <div className="page-heading [display:flex] [justify-content:space-between] [align-items:center] [gap:24px] [margin-bottom:30px] [&_p]:[color:light-dark(#52525b,_#a0a0a8)] [&_p]:[font-size:12px] [&_p]:[margin-top:12px] max-[720px]:[align-items:start] max-[720px]:[flex-direction:column] max-[720px]:[gap:20px]">
          <div>
            <div className="eyebrow [font-size:9px] [letter-spacing:1.7px] [color:light-dark(#52525b,_#8d8d95)] [font-weight:600] [text-transform:uppercase] [margin-bottom:13px]">
              NEW SERVICE
            </div>
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
    <>
      <ServiceForm key={service.id} service={service} />
      <ScalingPanel service={service} />
    </>
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
    <section className="panel p-6 [background:light-dark(#f4f4f5,_#131315)] [border:1px_solid_light-dark(#e4e4e7,_#28282c)] [border-radius:8px] [box-shadow:0_1px_0_#ffffff04_inset,_0_8px_24px_#0000000d]">
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
    <section
      className="panel p-6 [background:light-dark(#f4f4f5,_#131315)] [border:1px_solid_light-dark(#e4e4e7,_#28282c)] [border-radius:8px] [box-shadow:0_1px_0_#ffffff04_inset,_0_8px_24px_#0000000d]"
      aria-label="Service activity"
    >
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
          <div
            className="activity-event [display:flex] [gap:12px] [align-items:start] [padding:14px_0] [border-bottom:1px_solid_light-dark(#e4e4e7,_#242427)] [&_p]:[font-size:11px] [&_p]:[color:light-dark(#52525b,_#a0a0a8)] [&_p]:[margin-top:7px] [&_time]:[display:block] [&_time]:[font-size:10px] [&_time]:[color:light-dark(#52525b,_#8d8d95)] [&_time]:[margin-top:10px]"
            key={event.id}
          >
            <span
              className="activity-dot [&[data-state=succeeded]]:[color:#9bd2a8] [&[data-state=succeeded]]:[background:light-dark(#e4e4e7,_#18271d)] [&[data-state=succeeded]]:[border-color:#2d4a35] [&[data-state=failed]]:[color:#ffaaa1] [&[data-state=failed]]:[background:light-dark(#e4e4e7,_#2a1919)] [&[data-state=failed]]:[border-color:#4b2a2a] [&[data-state=interrupted]]:[color:#ffaaa1] [&[data-state=interrupted]]:[background:light-dark(#e4e4e7,_#2a1919)] [&[data-state=interrupted]]:[border-color:#4b2a2a] [border-radius:50%] [padding:5px] [background:light-dark(#e4e4e7,_#222225)] [color:light-dark(#27272a,_#c3c3ca)]"
              data-state={event.kind.split('.')[1]}
            >
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
      <div className="aside-divider [border-top:1px_solid_light-dark(#e4e4e7,_#28282c)] [margin:25px_0]" />
      <p className="text-xs text-muted break-all">
        Service ID
        <br />
        <span className="font-mono">{service.id}</span>
      </p>
    </section>
  )
}

function RootLayout() {
  const path = useRouterState({ select: (state) => state.location.pathname })
  const publicRoute = path === '/' || path === '/docs' || path.startsWith('/docs/')
  if (publicRoute) return <Outlet />
  return (
    <AuthShell>
      <Shell />
    </AuthShell>
  )
}

const rootRoute = createRootRoute({
  component: RootLayout,
  notFoundComponent: () => (
    <div>
      <h1>Page not found</h1>
      <Link
        to="/"
        className="back-link mt-5 [display:inline-flex] [gap:7px] [align-items:center] [font-size:11px] [color:light-dark(#52525b,_#a0a0a8)] [margin-bottom:25px] [&:hover]:[color:light-dark(#27272a,_#e7e7eb)]"
      >
        Return to services
      </Link>
    </div>
  ),
})
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: MarketingHome,
})
const docsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/docs',
  component: () => <DocsSite page="introduction" />,
})
const docsPageRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/docs/$slug',
  component: function DocumentationPage() {
    const { slug } = docsPageRoute.useParams()
    return <DocsSite page={slug} />
  },
})
const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/app',
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
const platformUserRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/platform/users/$userId',
  component: PlatformUserDetail,
})
const platformHostRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/platform/host',
  component: () => <PlatformAdmin view="host" />,
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
        <section className="panel p-6 [background:light-dark(#f4f4f5,_#131315)] [border:1px_solid_light-dark(#e4e4e7,_#28282c)] [border-radius:8px] [box-shadow:0_1px_0_#ffffff04_inset,_0_8px_24px_#0000000d]">
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
  scrollRestoration: true,
  defaultErrorComponent: RouteError,
  routeTree: rootRoute.addChildren([
    indexRoute,
    docsRoute,
    docsPageRoute,
    appRoute,
    platformOrganizationsRoute,
    platformUsersRoute,
    platformUserRoute,
    platformHostRoute,
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
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
)
