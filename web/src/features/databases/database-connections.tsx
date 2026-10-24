import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from '../../api-client'
import type { Service } from '../../generated/model/service'
import { Button } from '../../components/button'
import { Field } from '../../components/field'
import { Select } from '../../components/select'

export function DatabasePanel({ service }: { service: Service }) {
  const secretName = service.spec.workload.kind === 'redis-service' ? 'REDIS_URL' : 'DATABASE_URL'
  const client = useQueryClient()
  const [app, setApp] = useState('')
  const query = useQuery({
    queryKey: ['database', service.id],
    queryFn: () => api<DatabaseState>('/services/' + service.id + '/database'),
    refetchInterval: 5000,
  })
  const connect = useMutation({
    mutationFn: async () => {
      const secrets = await api<{ version: number }>('/services/' + app + '/secrets')
      return api('/services/' + app + '/database-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ databaseId: service.id, expectedSecretVersion: secrets.version }),
      })
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['database', service.id] })
      await client.invalidateQueries({ queryKey: ['secrets'] })
    },
  })
  return (
    <section className="panel space-y-5 p-6">
      <div className="section-heading">
        <h2>Database connections</h2>
        <span className="chip">Private · node pinned</span>
      </div>
      {query.data?.volume ? (
        <div className="revision-row text-sm">
          {query.data.volume.node} · {query.data.volume.sizeGib} GiB persistent storage
          <p className="mt-2 text-xs text-muted">
            Only explicitly connected services may reach this database.
          </p>
        </div>
      ) : (
        <p className="text-xs text-muted">
          Deploy the database image to allocate its volume and private endpoint.
        </p>
      )}
      <Field
        label="Connect an application"
        hint="Choose an application in this project and environment. This replaces its connection secret; redeploy it afterward."
      >
        <Select
          value={app}
          onChange={(e) => {
            setApp(e.target.value)
            connect.reset()
          }}
        >
          <option value="">Choose service</option>
          {query.data?.applications.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
              {a.connected ? ' · connected' : ''}
            </option>
          ))}
        </Select>
      </Field>
      <Button
        variant="primary"
        disabled={!app || !query.data?.volume || connect.isPending}
        onClick={() => connect.mutate()}
      >
        Set {secretName}
      </Button>
      {(query.error || connect.error) && (
        <p role="alert" className="error-notice">
          {(query.error || connect.error)?.message}
        </p>
      )}
      {connect.isSuccess && (
        <p role="status" className="text-xs text-emerald-300">
          Connection saved in OpenBao. Redeploy the application to use it.
        </p>
      )}
      <p className="text-xs text-muted">
        Stopping or replacing the database process retains its volume. Worker loss leaves the
        database unavailable until that same worker and disk return.
      </p>
    </section>
  )
}

export interface DatabaseState {
  volume: { node: string; sizeGib: number; host: string; port: number } | null
  applications: { id: string; name: string; connected: boolean | null }[]
}
