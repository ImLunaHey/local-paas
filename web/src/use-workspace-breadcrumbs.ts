import type { Project } from './workspace-types'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useParams, useRouterState, useSearch } from '@tanstack/react-router'

import { api } from './api-client'
import type { Service } from './generated/model/service'
import { serviceQuery } from './api'
import { projectsQuery } from './projects-query'

export function useWorkspaceBreadcrumbs() {
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
  const [switching, setSwitching] = useState(false)
  const [error, setError] = useState('')
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

  return { params, search, path, service, name, id, project, env, switching, error, change }
}
export type WorkspaceBreadcrumbsState = ReturnType<typeof useWorkspaceBreadcrumbs>
