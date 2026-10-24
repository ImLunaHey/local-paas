import type { FormEvent } from 'react'
import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearch } from '@tanstack/react-router'

import { api } from '../../api-client'
import type { Service } from '../../generated/model/service'
import type { ServiceSpec } from '../../generated/model/serviceSpec'

export function useDatabaseForm({
  service,
  initialEngine = 'postgres-service',
}: {
  service?: Service
  initialEngine?: 'postgres-service' | 'rustfs-service'
}) {
  const scope = useSearch({ strict: false }) as { project?: string; environment?: string }
  const navigate = useNavigate()
  const client = useQueryClient()
  const [engine, setEngine] = useState<'postgres-service' | 'redis-service' | 'rustfs-service'>(
    service?.spec.workload.kind === 'redis-service'
      ? 'redis-service'
      : service?.spec.workload.kind === 'rustfs-service'
        ? 'rustfs-service'
        : initialEngine,
  )
  const pg = service?.spec.workload.kind === 'postgres-service' ? service.spec.workload : undefined
  const capabilities = useQuery({
    queryKey: ['build-system'],
    queryFn: () => api<{ databaseRuntimeReady: boolean }>('/build-system'),
    refetchInterval: 5000,
  })
  const operation = useRef<{ input: string; id: string } | null>(null)
  const mutation = useMutation({
    mutationFn: (spec: ServiceSpec) => {
      const input = JSON.stringify({ spec, version: service?.version })
      if (operation.current?.input !== input) operation.current = { input, id: crypto.randomUUID() }
      return api<Service>(service ? '/services/' + service.id : '/services', {
        method: service ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          spec,
          operationId: operation.current.id,
          expectedVersion: service?.version,
        }),
      })
    },
    onSuccess: async (saved) => {
      operation.current = null
      await client.invalidateQueries({ queryKey: ['services'] })
      await client.invalidateQueries({ queryKey: ['projects'] })
      if (!service)
        void navigate({ to: '/services/$serviceId/builds', params: { serviceId: saved.id } })
    },
  })

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const data = new FormData(e.currentTarget)
    const text = (name: string) => String(data.get(name) ?? '')
    mutation.mutate({
      schemaVersion: 1,
      project: text('project'),
      environment: text('environment'),
      name: text('name'),
      source: { repository: '' },
      resources: { cpuMillis: Number(text('cpu')), memoryMib: Number(text('memory')) },
      distinctNodes: false,
      domains: [],
      secrets: service?.spec.secrets ?? [],
      workload:
        engine === 'postgres-service'
          ? { kind: engine, database: text('database'), storageGib: Number(text('storage')) }
          : { kind: engine, storageGib: Number(text('storage')) },
    })
  }
  return { submit, scope, engine, setEngine, pg, capabilities, mutation }
}
export type DatabaseFormState = ReturnType<typeof useDatabaseForm>
