import type { Jobs } from './job-types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from '../../api-client'
import type { Service } from '../../generated/model/service'
import { type Revision } from '../../api'

export function useServiceJobs({ service }: { service: Service }) {
  const client = useQueryClient()
  const supported = service.spec.workload.kind === 'oci-service'
  const jobs = useQuery({
    queryKey: ['jobs', service.id],
    queryFn: () => api<Jobs>(`/services/${service.id}/jobs`),
    enabled: supported,
    refetchInterval: 3000,
  })
  const revisions = useQuery({
    queryKey: ['revisions', service.id],
    queryFn: () => api<Revision[]>(`/services/${service.id}/revisions`),
    enabled: supported,
    refetchInterval: 5000,
  })
  const cancel = useMutation({
    mutationFn: (id: string) => api(`/deployments/${id}/stop`, { method: 'POST' }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['jobs', service.id] }),
  })
  const pause = useMutation({
    mutationFn: () => {
      const schedule = jobs.data!.schedule!
      return api(`/services/${service.id}/job-schedule`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operationId: crypto.randomUUID(),
          version: schedule.version,
          revisionId: schedule.revisionId,
          options: schedule.options,
          intervalMinutes: schedule.intervalMinutes,
          enabled: false,
        }),
      })
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ['jobs', service.id] }),
  })

  return { supported, jobs, revisions, cancel, pause }
}
export type JobsPanelState = ReturnType<typeof useServiceJobs>
