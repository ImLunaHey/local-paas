import { active } from './build-status'
import { useRef, useState } from 'react'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from '../../api-client'
import { sourceReference } from '../../api'
import type { Service } from '../../generated/model/service'
import type { Build, Revision, SourceKind } from '../../api'
export function useServiceBuilds({ service }: { service: Service }) {
  const client = useQueryClient()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const uploaded = !!service.spec.source?.upload
  const initialRef = sourceReference(service.spec.source)
  const [sourceKind, setSourceKind] = useState<SourceKind>(initialRef.kind)
  const [commit, setCommit] = useState(initialRef.value)
  const [noCache, setNoCache] = useState(false)
  const operation = useRef<{ input: string; id: string } | null>(null)
  const database =
    service.spec.workload.kind === 'postgres-service' ||
    service.spec.workload.kind === 'redis-service' ||
    service.spec.workload.kind === 'rustfs-service'
  const enabled = service.spec.workload.kind !== 'celld-service'
  const history = useQuery({
    queryKey: ['builds', service.id],
    enabled,
    queryFn: () => api<Build[]>(`/services/${service.id}/builds`),
    refetchInterval: 2000,
  })
  const system = useQuery({
    queryKey: ['build-system'],
    enabled,
    queryFn: () => api<{ workerOnline: boolean }>('/build-system'),
    refetchInterval: 5000,
  })
  const revisions = useQuery({
    queryKey: ['revisions', service.id],
    enabled,
    queryFn: () => api<Revision[]>(`/services/${service.id}/revisions`),
    refetchInterval: 3000,
  })
  const selected = history.data?.find((build) => build.id === selectedId) ?? history.data?.[0]
  const busy = history.data?.some(active) ?? false
  const create = useMutation({
    mutationFn: () => {
      const input = JSON.stringify({ [sourceKind]: commit.trim(), noCache: noCache })
      if (operation.current?.input !== input) operation.current = { input, id: crypto.randomUUID() }
      return api<Build>(`/services/${service.id}/builds`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(database || uploaded ? {} : { [sourceKind]: commit.trim() }),
          noCache: noCache,
          operationId: operation.current.id,
        }),
      })
    },
    onSuccess: async (build) => {
      operation.current = null
      setSelectedId(build.id)
      await client.invalidateQueries({ queryKey: ['builds', service.id] })
      await client.invalidateQueries({ queryKey: ['events', service.id] })
    },
  })
  const cancel = useMutation({
    mutationFn: (id: string) => api<Build>(`/builds/${id}/cancel`, { method: 'POST' }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['builds', service.id] })
      await client.invalidateQueries({ queryKey: ['events', service.id] })
    },
  })

  return {
    setSelectedId,
    uploaded,
    sourceKind,
    setSourceKind,
    commit,
    setCommit,
    noCache,
    setNoCache,
    database,
    enabled,
    history,
    system,
    revisions,
    selected,
    busy,
    create,
    cancel,
  }
}
export type BuildPanelState = ReturnType<typeof useServiceBuilds>
