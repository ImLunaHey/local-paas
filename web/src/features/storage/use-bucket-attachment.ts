import type { Storage } from './bucket-types'
import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../api-client'
import type { Service } from '../../generated/model/service'

export function useBucketAttachment({ service }: { service: Service }) {
  const managed = service.spec.workload.kind === 'rustfs-service'
  const client = useQueryClient()
  const state = useQuery({
    queryKey: ['buckets', service.id],
    queryFn: () => api<Storage>('/services/' + service.id + '/buckets'),
    refetchInterval: 5000,
  })
  const [name, setName] = useState('')
  const [bucket, setBucket] = useState('')
  const [readOnly, setReadOnly] = useState(false)
  const operation = useRef<{ name: string; id: string } | null>(null)
  const mutation = useMutation({
    mutationFn: async () => {
      if (managed) {
        if (operation.current?.name !== name) operation.current = { name, id: crypto.randomUUID() }
        return api('/services/' + service.id + '/buckets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, operationId: operation.current.id }),
        })
      }
      const secrets = await api<{ version: number }>('/services/' + service.id + '/secrets')
      return api('/services/' + service.id + '/storage-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bucketId: bucket,
          readOnly: readOnly,
          expectedSecretVersion: secrets.version,
        }),
      })
    },
    onSuccess: async () => {
      operation.current = null
      await client.invalidateQueries({ queryKey: ['buckets'] })
      await client.invalidateQueries({ queryKey: ['secrets'] })
      await client.invalidateQueries({ queryKey: ['services'] })
    },
  })
  const detach = useMutation({
    mutationFn: async () => {
      const secrets = await api<{ version: number }>('/services/' + service.id + '/secrets')
      return api('/services/' + service.id + '/storage-connection', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedSecretVersion: secrets.version }),
      })
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['buckets'] })
      await client.invalidateQueries({ queryKey: ['secrets'] })
      await client.invalidateQueries({ queryKey: ['services'] })
    },
  })
  const own = state.data?.buckets.filter((b) => b.storageId === service.id) ?? []
  const current = state.data?.buckets.find((b) => b.id === state.data?.binding?.bucketId)

  return {
    managed,
    state,
    name,
    setName,
    bucket,
    setBucket,
    readOnly,
    setReadOnly,
    mutation,
    detach,
    own,
    current,
  }
}
export type BucketPanelState = ReturnType<typeof useBucketAttachment>
