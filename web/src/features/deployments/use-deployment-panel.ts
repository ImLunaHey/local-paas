import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from '../../api-client'
import type { Service } from '../../generated/model/service'
import type { Revision } from '../../api'
import { useRuntime } from '../../runtime-query'
export function useDeploymentPanel({ service }: { service: Service }) {
  const client = useQueryClient()
  const runtime = useRuntime(service.id)
  const revisions = useQuery({
    queryKey: ['revisions', service.id],
    queryFn: () => api<Revision[]>(`/services/${service.id}/revisions`),
    enabled: service.spec.workload.kind !== 'celld-service',
  })
  const [chosen, setChosen] = useState('')
  const revision = chosen || revisions.data?.[0]?.id || ''
  const operation = useRef<{ revision: string; id: string } | null>(null)
  const deploy = useMutation({
    mutationFn: () => {
      if (operation.current?.revision !== revision)
        operation.current = { revision, id: crypto.randomUUID() }
      return api(`/services/${service.id}/deployments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operationId: operation.current.id, revisionId: revision }),
      })
    },
    onSuccess: async () => {
      operation.current = null
      await client.invalidateQueries({ queryKey: ['runtime', service.id] })
    },
  })
  const stop = useMutation({
    mutationFn: (id: string) => api(`/deployments/${id}/stop`, { method: 'POST' }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['runtime', service.id] })
    },
  })

  const rollback = useMutation({
    mutationFn: (id: string) => api(`/deployments/${id}/rollback`, { method: 'POST' }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['runtime', service.id] })
      await client.invalidateQueries({ queryKey: ['domains'] })
    },
  })

  const error = deploy.error || stop.error || rollback.error || runtime.error || revisions.error
  const preparing = runtime.data?.deployments.some(
    (d) =>
      ['releasing', 'waiting', 'preparing'].includes(d.status) ||
      (!!d.edgePhase && !['complete', 'failed'].includes(d.edgePhase)),
  )
  return { runtime, revisions, setChosen, revision, deploy, stop, rollback, error, preparing }
}
export type DeploymentPanelState = ReturnType<typeof useDeploymentPanel>
