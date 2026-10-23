import { Button, Input, Select, Field } from './ui'
import { useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { Plus, Layers3, ArrowLeft } from 'lucide-react'
import { api, type Service } from './api'
interface Environment {
  id: string
  name: string
  parent_id: string | null
  parent_name: string | null
  service_count: number
}
interface Project {
  id: string
  name: string
  environments: Environment[]
}
export const projectsQuery = {
  queryKey: ['projects'],
  queryFn: () =>
    api<{ items: { id: string; name: string; environments: number; services: number }[] }>(
      '/projects',
    ),
}
export function Projects() {
  const client = useQueryClient(),
    navigate = useNavigate()
  const projects = useQuery(projectsQuery)
  const [name, setName] = useState('')
  const create = useMutation({
    mutationFn: () =>
      api<{ id: string }>('/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      }),
    onSuccess: async (p) => {
      await client.invalidateQueries({ queryKey: ['projects'] })
      void navigate({ to: '/projects/$projectId', params: { projectId: p.id } })
    },
  })
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">YOUR WORKSPACE</div>
          <h1>Projects</h1>
          <p>Applications and databases, grouped by project and environment.</p>
        </div>
      </div>
      <form
        className="flex flex-wrap gap-3 mb-7"
        onSubmit={(e) => {
          e.preventDefault()
          create.mutate()
        }}
      >
        <Input
          className="input"
          aria-label="Project name"
          placeholder="Project name"
          required
          pattern="[a-z0-9]+(-[a-z0-9]+)*"
          maxLength={63}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Button variant="primary" disabled={create.isPending} type="submit">
          <Plus size={15} />
          Create project
        </Button>
      </form>
      {(projects.error || create.error) && (
        <p role="alert" className="error-notice">
          {(projects.error || create.error)?.message}
        </p>
      )}
      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
        {projects.data?.items.map((p) => (
          <Link
            key={p.id}
            to="/projects/$projectId"
            params={{ projectId: p.id }}
            className="panel p-6 space-y-4 hover:border-neutral-600"
          >
            <Layers3 size={22} className="text-accent" />
            <h2>{p.name}</h2>
            <p className="text-xs text-muted">
              {p.services} services · {p.environments} environments
            </p>
          </Link>
        ))}
      </div>
      {projects.data?.items.length === 0 && (
        <p className="text-muted">Create a project to add your first service.</p>
      )}
    </>
  )
}
export function ProjectWorkspace({
  renderService,
}: {
  renderService: (service: Service) => ReactNode
}) {
  const { projectId } = useParams({ strict: false }) as { projectId: string }
  const search = useSearch({ strict: false }) as { environment?: string }
  const navigate = useNavigate(),
    client = useQueryClient()
  const project = useQuery({
    queryKey: ['projects', projectId],
    queryFn: () => api<Project>('/projects/' + projectId),
  })
  const env =
    project.data?.environments.find((e) => e.name === search.environment) ??
    project.data?.environments.find((e) => e.name === 'production') ??
    project.data?.environments[0]
  const [offset, setOffset] = useState(0),
    [name, setName] = useState(''),
    [parent, setParent] = useState('')
  const params = new URLSearchParams({
    project: project.data?.name ?? '',
    environment: env?.name ?? '',
    offset: String(offset),
  })
  const services = useQuery({
    queryKey: ['services', projectId, env?.id, offset],
    queryFn: () => api<{ items: Service[]; total: number }>('/services?' + params),
    enabled: !!env,
  })
  const create = useMutation({
    mutationFn: () =>
      api('/environments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project: project.data?.name, name, parent_id: parent || null }),
      }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['projects'] })
      await client.invalidateQueries({ queryKey: ['environments'] })
      void navigate({
        to: '/projects/$projectId',
        params: { projectId },
        search: { environment: name },
      })
      setName('')
      setParent('')
    },
  })
  return (
    <>
      <Link to="/" className="back-link mb-6">
        <ArrowLeft size={14} />
        All projects
      </Link>
      <div className="page-heading">
        <div>
          <div className="eyebrow">PROJECT</div>
          <h1>{project.data?.name ?? 'Loading…'}</h1>
          <p>Services share an environment. Deployments and secrets stay isolated.</p>
        </div>
        <Link
          to="/services/new"
          search={{ project: project.data?.name, environment: env?.name }}
          className="button primary"
        >
          <Plus size={15} />
          Add service
        </Link>
      </div>
      {(project.error || services.error || create.error) && (
        <p role="alert" className="error-notice">
          {(project.error || services.error || create.error)?.message}
        </p>
      )}
      <div className="flex flex-wrap gap-5 items-center mb-6">
        <Field label="Environment">
          <Select
            aria-label="Project environment"
            value={env?.name ?? ''}
            onChange={(e) => {
              setOffset(0)
              void navigate({
                to: '/projects/$projectId',
                params: { projectId },
                search: { environment: e.target.value },
              })
            }}
          >
            {project.data?.environments.map((e) => (
              <option key={e.id} value={e.name}>
                {e.name}
              </option>
            ))}
          </Select>
        </Field>
        {env?.parent_name && (
          <p className="text-xs text-muted">
            Shadows {env.parent_name} · local secrets override inherited values
          </p>
        )}
      </div>
      <details className="panel p-5 mb-7">
        <summary className="cursor-pointer text-sm">Create or shadow an environment</summary>
        <form
          className="grid sm:grid-cols-3 gap-3 mt-5 items-end"
          onSubmit={(e) => {
            e.preventDefault()
            create.mutate()
          }}
        >
          <Field label="Environment name">
            <Input
              required
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
              maxLength={63}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="staging"
            />
          </Field>
          <Field label="Shadow source">
            <Select value={parent} onChange={(e) => setParent(e.target.value)}>
              <option value="">Independent environment</option>
              {project.data?.environments.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </Select>
          </Field>
          <Button disabled={create.isPending} type="submit">
            Create environment
          </Button>
        </form>
        <p className="text-xs text-muted mt-4">
          Shadowing copies service configuration and inherits secrets. Override values such as
          DATABASE_URL before deploying. Domains, running instances and database contents are not
          copied.
        </p>
      </details>
      <section className="panel overflow-hidden" aria-label="Project services">
        <div className="service-table-head">
          <span>SERVICE / SOURCE</span>
          <span>WORKLOAD</span>
          <span>STATUS</span>
        </div>
        {services.data?.items.map(renderService)}
        {services.data?.total === 0 && (
          <div className="p-10 text-sm text-muted">
            No services in {env?.name}. Add an application or database to get started.
          </div>
        )}
      </section>
      {(services.data?.total ?? 0) > 50 && (
        <div className="flex gap-3 mt-5">
          <Button disabled={!offset} onClick={() => setOffset(Math.max(0, offset - 50))}>
            Previous
          </Button>
          <Button
            disabled={offset + 50 >= services.data!.total}
            onClick={() => setOffset(offset + 50)}
          >
            Next
          </Button>
        </div>
      )}
    </>
  )
}

export function ProjectBackLink({
  project,
  environment,
}: {
  project?: string
  environment?: string
}) {
  const projects = useQuery(projectsQuery)
  const selected = projects.data?.items.find((item) => item.name === project)
  return selected ? (
    <Link
      to="/projects/$projectId"
      params={{ projectId: selected.id }}
      search={{ environment }}
      className="back-link"
    >
      <ArrowLeft size={14} />
      Project services
    </Link>
  ) : (
    <Link to="/" className="back-link">
      <ArrowLeft size={14} />
      All projects
    </Link>
  )
}
