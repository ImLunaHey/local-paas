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
    <section className="panel space-y-5 p-6 [background:light-dark(#f4f4f5,_#131315)] [border:1px_solid_light-dark(#e4e4e7,_#28282c)] [border-radius:8px] [box-shadow:0_1px_0_#ffffff04_inset,_0_8px_24px_#0000000d]">
      <div className="section-heading [display:flex] [justify-content:space-between] [align-items:center] [margin-bottom:15px] [gap:12px] max-[720px]:[&_.tiny-label]:[font-size:8px] max-[720px]:[&_.tiny-label]:[letter-spacing:0.6px]">
        <h2>Database connections</h2>
        <span className="chip [&[data-state=succeeded]]:[color:#9bd2a8] [&[data-state=succeeded]]:[background:light-dark(#e4e4e7,_#18271d)] [&[data-state=succeeded]]:[border-color:#2d4a35] [&[data-state=failed]]:[color:#ffaaa1] [&[data-state=failed]]:[background:light-dark(#e4e4e7,_#2a1919)] [&[data-state=failed]]:[border-color:#4b2a2a] [&[data-state=interrupted]]:[color:#ffaaa1] [&[data-state=interrupted]]:[background:light-dark(#e4e4e7,_#2a1919)] [&[data-state=interrupted]]:[border-color:#4b2a2a] [&[data-state=running]]:[color:#ffb282] [&[data-state=running]]:[background:#2c1c12] [&[data-state=running]]:[border-color:#4e3120] [&[data-state=queued]]:[color:#ffb282] [&[data-state=queued]]:[background:#2c1c12] [&[data-state=queued]]:[border-color:#4e3120] [display:inline-flex] [align-items:center] [gap:6px] [border:1px_solid_light-dark(#d4d4d8,_#38383c)] [background:light-dark(#e4e4e7,_#1b1b1e)] [color:light-dark(#27272a,_#c3c3ca)] [font-size:10px] [padding:5px_8px] [border-radius:5px] [white-space:nowrap]">
          Private · node pinned
        </span>
      </div>
      {query.data?.volume ? (
        <div className="revision-row text-sm [border:1px_solid_light-dark(#d4d4d8,_#2c2c30)] [border-radius:6px] [padding:14px] [background:light-dark(#f4f4f5,_#19191b)] [&_code]:[color:light-dark(#27272a,_#d5d5dc)]">
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
        <p
          role="alert"
          className="error-notice [border:1px_solid_#4d2b2d] [background:light-dark(#f4f4f5,_#231719)] [border-radius:7px] [padding:18px] [font-size:12px] [color:#ffb4ae] [line-height:1.8] [overflow-wrap:anywhere] [&_p]:[margin-top:5px]"
        >
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
