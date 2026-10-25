import type { DomainObservation as Domain } from '../../generated/model/domainObservation'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from '../../api-client'
import type { Service } from '../../generated/model/service'
import { projectsQuery } from '../../projects-query'

export function useDomainAssignment({ domain }: { domain: Domain }) {
  const client = useQueryClient()
  const [project, setProject] = useState(domain.projectId ?? '')
  const [environment, setEnvironment] = useState(domain.environment ?? '')
  const [service, setService] = useState(domain.serviceId ?? '')
  const projects = useQuery(projectsQuery)
  const detail = useQuery({
    queryKey: ['projects', project],
    queryFn: () =>
      api<{ id: string; name: string; environments: { id: string; name: string }[] }>(
        '/projects/' + project,
      ),
    enabled: !!project,
  })
  const services = useQuery({
    queryKey: ['domain-services', project, environment],
    queryFn: () =>
      api<{ items: Service[]; total: number }>(
        '/services?' +
          new URLSearchParams({ project: detail.data!.name, environment, offset: '0' }),
      ),
    enabled: !!detail.data && !!environment,
  })
  const save = useMutation({
    mutationFn: () =>
      api('/domains/' + encodeURIComponent(domain.hostname), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serviceId: service || null, expectedVersion: domain.version }),
      }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['domains'] })
    },
  })

  return {
    project,
    setProject,
    environment,
    setEnvironment,
    service,
    setService,
    projects,
    detail,
    services,
    save,
  }
}
export type DomainAssignmentState = ReturnType<typeof useDomainAssignment>
