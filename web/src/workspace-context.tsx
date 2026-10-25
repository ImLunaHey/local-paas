import type { Project } from './workspace-types'
import { useWorkspaceBreadcrumbs } from './use-workspace-breadcrumbs'
import { useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import { ChevronRight } from 'lucide-react'
import { api } from './api-client'

import { projectsQuery } from './projects-query'
import { Button } from './components/button'
import { Field } from './components/field'
import { Select } from './components/select'

export function CreationScope({ children }: { children: ReactNode }) {
  const search = useSearch({ strict: false }) as { project?: string; environment?: string }
  const navigate = useNavigate()
  const projects = useQuery(projectsQuery)
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
      <div className="page-heading [display:flex] [justify-content:space-between] [align-items:center] [gap:24px] [margin-bottom:30px] [&_p]:[color:light-dark(#52525b,_#a0a0a8)] [&_p]:[font-size:12px] [&_p]:[margin-top:12px] max-[720px]:[align-items:start] max-[720px]:[flex-direction:column] max-[720px]:[gap:20px]">
        <div>
          <h1>Add a service</h1>
          <p>Choose where this service will live.</p>
        </div>
      </div>
      <form
        className="panel max-w-xl space-y-5 p-6 [background:light-dark(#f4f4f5,_#131315)] [border:1px_solid_light-dark(#e4e4e7,_#28282c)] [border-radius:8px] [box-shadow:0_1px_0_#ffffff04_inset,_0_8px_24px_#0000000d]"
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
          <p
            role="alert"
            className="error-notice [border:1px_solid_#4d2b2d] [background:light-dark(#f4f4f5,_#231719)] [border-radius:7px] [padding:18px] [font-size:12px] [color:#ffb4ae] [line-height:1.8] [overflow-wrap:anywhere] [&_p]:[margin-top:5px]"
          >
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
  const { path, service, id, project, env, switching, error, change } = useWorkspaceBreadcrumbs()
  if (!project.data)
    return (
      <span className="flex items-center gap-2">
        <span className="text-muted">Workspace</span>
        <ChevronRight size={13} />
        {workspaceLabel(path)}
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

function workspaceLabel(path: string) {
  const labels: Record<string, string> = {
    '/': 'Overview',
    '/nodes': 'Nodes',
    '/hosts': 'Hosts',
    '/domains': 'Domains',
    '/audit': 'Audit log',
    '/organization': 'Organization',
  }
  return labels[path] ?? 'Projects'
}
