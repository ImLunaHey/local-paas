import type { Volume } from './volume-types'
import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from '../../api-client'
import type { Service } from '../../generated/model/service'

export function useVolumeAttachment({ service }: { service: Service }) {
  const client = useQueryClient()
  const current = service.spec.volume
  const [id, setId] = useState(current?.id ?? '')
  const [path, setPath] = useState(current?.mountPath ?? '/data')
  const [readOnly, setReadOnly] = useState(current?.readOnly ?? false)
  const [name, setName] = useState('')
  const [size, setSize] = useState(1)
  const operation = useRef<{ key: string; id: string } | null>(null)
  const scope = { project: service.spec.project, environment: service.spec.environment }
  const volumes = useQuery({
    queryKey: ['volumes', scope.project, scope.environment],
    queryFn: () => api<{ items: Volume[] }>('/volumes?' + new URLSearchParams(scope)),
    refetchInterval: 5000,
  })
  const selected = volumes.data?.items.find((v) => v.id === id)
  const create = useMutation({
    mutationFn: () => {
      const key = JSON.stringify({ name, size, ...scope })
      if (operation.current?.key !== key) operation.current = { key, id: crypto.randomUUID() }
      return api<{ id: string }>('/volumes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...scope,
          name,
          sizeGib: size,
          operationId: operation.current.id,
        }),
      })
    },
    onSuccess: async (v) => {
      operation.current = null
      setId(v.id)
      setName('')
      await client.invalidateQueries({ queryKey: ['volumes'] })
    },
  })
  const save = useMutation({
    mutationFn: () =>
      api<Service>('/services/' + service.id, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operationId: crypto.randomUUID(),
          expectedVersion: service.version,
          spec: {
            ...service.spec,
            volume: id ? { id, mountPath: path, readOnly: readOnly } : undefined,
            workload:
              service.spec.workload.kind === 'oci-service' && id
                ? { ...service.spec.workload, replicas: 1 }
                : service.spec.workload,
          },
        }),
      }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['services'] })
      await client.invalidateQueries({ queryKey: ['volumes'] })
    },
  })

  return {
    current,
    id,
    setId,
    path,
    setPath,
    readOnly,
    setReadOnly,
    name,
    setName,
    size,
    setSize,
    volumes,
    selected,
    create,
    save,
  }
}
export type StoragePanelState = ReturnType<typeof useVolumeAttachment>
