import { projectsQuery } from './projects-query'
import type { ProjectDetail as Project } from './generated/model/projectDetail'
import { getGetProjectQueryOptions, createProject, updateProject } from './generated/management'
import { ProjectNameForm } from './features/projects/project-name-form'
import { Button } from './components/button'
import { Input } from './components/input'
import { Select } from './components/select'
import { Field } from './components/field'
import { useEffect, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { Plus, Layers3, ArrowLeft } from 'lucide-react'
import { api } from './api-client'
import type { Service } from './generated/model/service'
export function Projects() {
  const client = useQueryClient()
  const navigate = useNavigate()
  const projects = useQuery(projectsQuery)
  const create = useMutation({
    mutationFn: (name: string) => createProject({ name }),
    onSuccess: async (p) => {
      await client.invalidateQueries({ queryKey: ['projects'] })
      void navigate({ to: '/projects/$projectId', params: { projectId: p.id } })
    },
  })
  return (
    <>
      <div className="page-heading [display:flex] [justify-content:space-between] [align-items:center] [gap:24px] [margin-bottom:30px] [&_p]:[color:light-dark(#52525b,_#a0a0a8)] [&_p]:[font-size:12px] [&_p]:[margin-top:12px] max-[720px]:[align-items:start] max-[720px]:[flex-direction:column] max-[720px]:[gap:20px]">
        <div>
          <div className="eyebrow [font-size:9px] [letter-spacing:1.7px] [color:light-dark(#52525b,_#8d8d95)] [font-weight:600] [text-transform:uppercase] [margin-bottom:13px]">
            YOUR WORKSPACE
          </div>
          <h1>Projects</h1>
          <p>Applications and databases, grouped by project and environment.</p>
        </div>
      </div>
      <ProjectNameForm
        className="mb-7 max-w-xl"
        label="Create project"
        onSave={(name) => create.mutateAsync(name)}
      />

      {(projects.error || create.error) && (
        <p
          role="alert"
          className="error-notice [border:1px_solid_#4d2b2d] [background:light-dark(#f4f4f5,_#231719)] [border-radius:7px] [padding:18px] [font-size:12px] [color:#ffb4ae] [line-height:1.8] [overflow-wrap:anywhere] [&_p]:[margin-top:5px]"
        >
          {(projects.error || create.error)?.message}
        </p>
      )}
      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
        {projects.data?.items.map((p) => (
          <Link
            key={p.id}
            to="/projects/$projectId"
            params={{ projectId: p.id }}
            className="panel p-6 space-y-4 hover:border-neutral-600 [background:light-dark(#f4f4f5,_#131315)] [border:1px_solid_light-dark(#e4e4e7,_#28282c)] [border-radius:8px] [box-shadow:0_1px_0_#ffffff04_inset,_0_8px_24px_#0000000d]"
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
  const navigate = useNavigate()
  const client = useQueryClient()
  const project = useQuery(
    getGetProjectQueryOptions<Project, Error>(projectId, {
      query: { queryKey: ['projects', projectId] },
    }),
  )
  const env =
    project.data?.environments.find((e) => e.name === search.environment) ??
    project.data?.environments.find((e) => e.name === 'production') ??
    project.data?.environments[0]
  const [offset, setOffset] = useState(0)
  const [name, setName] = useState('')
  const [parent, setParent] = useState('')
  useEffect(() => setOffset(0), [env?.id])
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
        body: JSON.stringify({ project: project.data?.name, name, parentId: parent || null }),
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
      <Link
        to="/projects"
        className="back-link mb-6 [display:inline-flex] [gap:7px] [align-items:center] [font-size:11px] [color:light-dark(#52525b,_#a0a0a8)] [margin-bottom:25px] [&:hover]:[color:light-dark(#27272a,_#e7e7eb)]"
      >
        <ArrowLeft size={14} />
        All projects
      </Link>
      <div className="page-heading [display:flex] [justify-content:space-between] [align-items:center] [gap:24px] [margin-bottom:30px] [&_p]:[color:light-dark(#52525b,_#a0a0a8)] [&_p]:[font-size:12px] [&_p]:[margin-top:12px] max-[720px]:[align-items:start] max-[720px]:[flex-direction:column] max-[720px]:[gap:20px]">
        <div>
          <div className="eyebrow [font-size:9px] [letter-spacing:1.7px] [color:light-dark(#52525b,_#8d8d95)] [font-weight:600] [text-transform:uppercase] [margin-bottom:13px]">
            PROJECT
          </div>
          <h1>{project.data?.name ?? 'Loading…'}</h1>
          <p>Services share an environment. Deployments and secrets stay isolated.</p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            to="/projects/$projectId/settings"
            params={{ projectId }}
            className="button secondary [display:inline-flex] [align-items:center] [justify-content:center] [gap:8px] [font-size:11px] [font-weight:600] [line-height:1] [white-space:nowrap] [border:1px_solid_transparent] [border-radius:6px] [padding:12px_15px] [&.primary]:[background:#ff8a4c] [&.primary]:[color:#1b100a] [&.primary]:[border-color:#ff8a4c] [&.primary:hover]:[background:#ffa36c] [&.secondary]:[background:light-dark(#e4e4e7,_#1b1b1e)] [&.secondary]:[border-color:light-dark(#d4d4d8,_#38383c)] [&.secondary]:[color:light-dark(#27272a,_#e7e7eb)] [&.secondary:hover]:[background:light-dark(#e4e4e7,_#1b1b1e)]"
          >
            Settings
          </Link>
          <Link
            to="/services/new"
            search={{ project: project.data?.name, environment: env?.name }}
            className="button primary [display:inline-flex] [align-items:center] [justify-content:center] [gap:8px] [font-size:11px] [font-weight:600] [line-height:1] [white-space:nowrap] [border:1px_solid_transparent] [border-radius:6px] [padding:12px_15px] [&.primary]:[background:#ff8a4c] [&.primary]:[color:#1b100a] [&.primary]:[border-color:#ff8a4c] [&.primary:hover]:[background:#ffa36c] [&.secondary]:[background:light-dark(#e4e4e7,_#1b1b1e)] [&.secondary]:[border-color:light-dark(#d4d4d8,_#38383c)] [&.secondary]:[color:light-dark(#27272a,_#e7e7eb)] [&.secondary:hover]:[background:light-dark(#e4e4e7,_#1b1b1e)]"
          >
            <Plus size={15} />
            Add service
          </Link>
        </div>
      </div>
      {(project.error || services.error || create.error) && (
        <p
          role="alert"
          className="error-notice [border:1px_solid_#4d2b2d] [background:light-dark(#f4f4f5,_#231719)] [border-radius:7px] [padding:18px] [font-size:12px] [color:#ffb4ae] [line-height:1.8] [overflow-wrap:anywhere] [&_p]:[margin-top:5px]"
        >
          {(project.error || services.error || create.error)?.message}
        </p>
      )}
      <div className="flex flex-wrap gap-5 items-center mb-6">
        {env?.parentName && (
          <p className="text-xs text-muted">
            Shadows {env.parentName} · local secrets override inherited values
          </p>
        )}
      </div>
      <details className="panel p-5 mb-7 [background:light-dark(#f4f4f5,_#131315)] [border:1px_solid_light-dark(#e4e4e7,_#28282c)] [border-radius:8px] [box-shadow:0_1px_0_#ffffff04_inset,_0_8px_24px_#0000000d]">
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
      <section
        className="panel overflow-hidden [background:light-dark(#f4f4f5,_#131315)] [border:1px_solid_light-dark(#e4e4e7,_#28282c)] [border-radius:8px] [box-shadow:0_1px_0_#ffffff04_inset,_0_8px_24px_#0000000d]"
        aria-label="Project services"
      >
        <div className="service-table-head [display:grid] [grid-template-columns:minmax(150px,_1fr)_130px_100px_110px_150px] [gap:16px] [align-items:center] [padding:19px_22px] [font-size:9px] [letter-spacing:1px] [color:light-dark(#52525b,_#8d8d95)] [border-bottom:1px_solid_light-dark(#e4e4e7,_#28282c)] max-[1100px]:[grid-template-columns:minmax(0,_1fr)_130px] max-[1100px]:[gap:10px] max-[1100px]:[&_>_:nth-child(2)]:[display:none] max-[1200px]:[grid-template-columns:minmax(140px,_1fr)_90px_100px_135px] max-[1200px]:[&_>_:nth-child(2)]:[display:none] max-[720px]:[display:none]">
          <span>SERVICE / SOURCE</span>
          <span>WORKLOAD</span>
          <span>CPU</span>
          <span>MEMORY</span>
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
      className="back-link [display:inline-flex] [gap:7px] [align-items:center] [font-size:11px] [color:light-dark(#52525b,_#a0a0a8)] [margin-bottom:25px] [&:hover]:[color:light-dark(#27272a,_#e7e7eb)]"
    >
      <ArrowLeft size={14} />
      Project services
    </Link>
  ) : (
    <Link
      to="/projects"
      className="back-link [display:inline-flex] [gap:7px] [align-items:center] [font-size:11px] [color:light-dark(#52525b,_#a0a0a8)] [margin-bottom:25px] [&:hover]:[color:light-dark(#27272a,_#e7e7eb)]"
    >
      <ArrowLeft size={14} />
      All projects
    </Link>
  )
}

export function ProjectSettings() {
  const { projectId } = useParams({ strict: false }) as { projectId: string }
  const client = useQueryClient()
  const project = useQuery(
    getGetProjectQueryOptions<Project, Error>(projectId, {
      query: { queryKey: ['projects', projectId] },
    }),
  )
  const save = useMutation({
    mutationFn: (name: string) =>
      updateProject(projectId, { name, expectedName: project.data!.name }),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['projects'] }),
        client.invalidateQueries({ queryKey: ['services'] }),
        client.invalidateQueries({ queryKey: ['search'] }),
        client.invalidateQueries({ queryKey: ['environments'] }),
      ])
    },
  })
  return (
    <>
      <Link
        to="/projects/$projectId"
        params={{ projectId }}
        className="back-link mb-6 [display:inline-flex] [gap:7px] [align-items:center] [font-size:11px] [color:light-dark(#52525b,_#a0a0a8)] [margin-bottom:25px] [&:hover]:[color:light-dark(#27272a,_#e7e7eb)]"
      >
        <ArrowLeft size={14} />
        Project services
      </Link>
      <div className="page-heading [display:flex] [justify-content:space-between] [align-items:center] [gap:24px] [margin-bottom:30px] [&_p]:[color:light-dark(#52525b,_#a0a0a8)] [&_p]:[font-size:12px] [&_p]:[margin-top:12px] max-[720px]:[align-items:start] max-[720px]:[flex-direction:column] max-[720px]:[gap:20px]">
        <div>
          <div className="eyebrow [font-size:9px] [letter-spacing:1.7px] [color:light-dark(#52525b,_#8d8d95)] [font-weight:600] [text-transform:uppercase] [margin-bottom:13px]">
            PROJECT SETTINGS
          </div>
          <h1>{project.data?.name ?? 'Loading…'}</h1>
          <p>Manage this project's identity.</p>
        </div>
      </div>
      <section className="panel max-w-2xl space-y-5 p-6 [background:light-dark(#f4f4f5,_#131315)] [border:1px_solid_light-dark(#e4e4e7,_#28282c)] [border-radius:8px] [box-shadow:0_1px_0_#ffffff04_inset,_0_8px_24px_#0000000d]">
        <p className="text-xs leading-relaxed text-muted">
          Renaming keeps the project's services, environments, secrets and URLs. Existing deployment
          history keeps its original name.
        </p>
        {project.data && (
          <ProjectNameForm
            key={projectId}
            initialName={project.data.name}
            label="Save changes"
            onSave={(name) => save.mutateAsync(name)}
          />
        )}
        {project.error && (
          <p
            role="alert"
            className="error-notice [border:1px_solid_#4d2b2d] [background:light-dark(#f4f4f5,_#231719)] [border-radius:7px] [padding:18px] [font-size:12px] [color:#ffb4ae] [line-height:1.8] [overflow-wrap:anywhere] [&_p]:[margin-top:5px]"
          >
            {project.error.message}
          </p>
        )}
        {save.isSuccess && (
          <p role="status" className="text-xs text-emerald-300">
            Project settings saved.
          </p>
        )}
      </section>
    </>
  )
}
