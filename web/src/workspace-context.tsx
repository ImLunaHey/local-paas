import { useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate, useParams, useRouterState, useSearch } from '@tanstack/react-router'
import { ChevronRight } from 'lucide-react'
import { api, serviceQuery, type Service } from './api'
import { projectsQuery } from './projects'
import { Button, Field, Select } from './ui'
interface Project {
  id: string
  name: string
  environments: { id: string; name: string }[]
}
export function CreationScope({ children }: { children: ReactNode }) {
  const search = useSearch({ strict: false }) as { project?: string; environment?: string }
  const navigate = useNavigate(),
    projects = useQuery(projectsQuery)
  const [chosen, setChosen] = useState('')
  const selected = projects.data?.items.find((p) => p.name === search.project)
  const id = chosen || selected?.id || ''
  const project = useQuery({
    queryKey: ['projects', id],
    queryFn: () => api<Project>('/projects/' + id),
    enabled: !!id,
  })
  const [environment, setEnvironment] = useState('')
  const env =
    environment ||
    project.data?.environments.find((e) => e.name === 'production')?.name ||
    project.data?.environments[0]?.name ||
    ''
  if (
    selected &&
    project.data &&
    project.data.name === search.project &&
    project.data.environments.some((e) => e.name === search.environment)
  )
    return <>{children}</>
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Add a service</h1>
          <p>Choose where this service will live.</p>
        </div>
      </div>
      <form
        className="panel max-w-xl space-y-5 p-6"
        onSubmit={(e) => {
          e.preventDefault()
          void navigate({
            to: '/services/new',
            search: { project: project.data!.name, environment: env },
            replace: true,
          })
        }}
      >
        <Field label="Project">
          <Select
            aria-label="Choose project"
            value={id}
            onChange={(e) => {
              setChosen(e.target.value)
              setEnvironment('')
            }}
          >
            <option value="">Choose a project</option>
            {projects.data?.items.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Environment">
          <Select
            aria-label="Choose environment"
            value={env}
            disabled={!project.data}
            onChange={(e) => setEnvironment(e.target.value)}
          >
            {project.data?.environments.map((e) => (
              <option key={e.id} value={e.name}>
                {e.name}
              </option>
            ))}
          </Select>
        </Field>
        {(projects.error || project.error) && (
          <p role="alert" className="error-notice">
            {(projects.error || project.error)?.message}
          </p>
        )}
        <Button variant="primary" disabled={!project.data || !env} type="submit">
          Continue
        </Button>
        <Link to="/projects" className="ml-4 text-xs text-muted">
          Manage projects
        </Link>
      </form>
    </>
  )
}
export function WorkspaceBreadcrumbs() {
  const params = useParams({ strict: false }) as { projectId?: string; serviceId?: string }
  const search = useSearch({ strict: false }) as { project?: string; environment?: string }
  const path = useRouterState({ select: (s) => s.location.pathname })
  const navigate = useNavigate()
  const service = useQuery({ ...serviceQuery(params.serviceId ?? ''), enabled: !!params.serviceId })
  const projects = useQuery({
    ...projectsQuery,
    enabled: !!params.serviceId || path === '/services/new',
  })
  const name = service.data?.spec.project ?? search.project
  const id = params.projectId ?? projects.data?.items.find((p) => p.name === name)?.id ?? ''
  const project = useQuery({
    queryKey: ['projects', id],
    queryFn: () => api<Project>('/projects/' + id),
    enabled: !!id,
  })
  const env =
    service.data?.spec.environment ??
    search.environment ??
    project.data?.environments.find((e) => e.name === 'production')?.name ??
    project.data?.environments[0]?.name ??
    ''
  const [switching, setSwitching] = useState(false),
    [error, setError] = useState('')
  async function change(environment: string) {
    setSwitching(true)
    setError('')
    try {
      if (path === '/services/new')
        await navigate({
          to: '/services/new',
          search: { project: project.data!.name, environment },
        })
      else if (service.data) {
        const results = await api<{ items: Service[] }>(
          '/services?' + new URLSearchParams({ project: project.data!.name, environment }),
        )
        const sibling = results.items.find((s) => s.spec.name === service.data!.spec.name)
        if (sibling)
          await navigate({
            to: '/services/$serviceId/' + (path.split('/')[3] ?? 'builds'),
            params: { serviceId: sibling.id },
          })
        else
          await navigate({
            to: '/projects/$projectId',
            params: { projectId: id },
            search: { environment },
          })
      } else
        await navigate({
          to: '/projects/$projectId',
          params: { projectId: id },
          search: { environment },
        })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSwitching(false)
    }
  }
  if (!project.data)
    return (
      <span className="flex items-center gap-2">
        <span className="text-muted">Workspace</span>
        <ChevronRight size={13} />
        {path === '/'
          ? 'Overview'
          : path === '/nodes'
            ? 'Nodes'
            : path === '/hosts'
              ? 'Hosts'
              : path === '/domains'
                ? 'Domains'
                : path === '/audit'
                  ? 'Audit log'
                  : 'Projects'}
      </span>
    )
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2" aria-label="Breadcrumbs">
      <Link to="/projects" className="text-muted">
        Projects
      </Link>
      <ChevronRight size={13} />
      <Link
        className="max-w-40 truncate"
        to="/projects/$projectId"
        params={{ projectId: id }}
        search={{ environment: env }}
      >
        {project.data.name}
      </Link>
      <ChevronRight size={13} />
      <Select
        aria-label="Project environment"
        className="min-h-8 max-w-40 w-auto px-2 py-1 text-xs"
        value={env}
        disabled={switching}
        onChange={(e) => void change(e.target.value)}
      >
        {project.data.environments.map((e) => (
          <option key={e.id} value={e.name}>
            {e.name}
          </option>
        ))}
      </Select>
      {service.data && (
        <>
          <ChevronRight size={13} />
          <span className="max-w-36 truncate">{service.data.spec.name}</span>
          <span className="shrink-0 rounded border border-zinc-700 bg-zinc-800/60 px-2 py-0.5 text-[10px] font-medium text-zinc-300">
            {service.data.spec.workload.kind === 'postgres-service' ||
            service.data.spec.workload.kind === 'redis-service'
              ? 'Database'
              : service.data.spec.workload.kind === 'rustfs-service'
                ? 'Storage'
                : 'Service'}
          </span>
        </>
      )}
      {error && (
        <span role="alert" className="text-xs text-red-300">
          {error}
        </span>
      )}
    </div>
  )
}
