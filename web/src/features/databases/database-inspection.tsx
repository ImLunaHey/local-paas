import { PostgresInspection } from './postgres-inspection'
import { RedisInspection } from './redis-inspection'

import type { Snapshot } from './database-inspection-types'

import { useQuery } from '@tanstack/react-query'
import { useSearch } from '@tanstack/react-router'

import { Database, RefreshCw } from 'lucide-react'
import { api } from '../../api-client'
import type { Service } from '../../generated/model/service'
import { Button } from '../../components/button'

export function DatabaseInspector({ service }: { service: Service }) {
  const { table } = useSearch({ strict: false }) as { table?: number }
  const isDatabase =
    service.spec.workload.kind === 'postgres-service' ||
    service.spec.workload.kind === 'redis-service'
  const query = useQuery({
    queryKey: ['database-inspection', service.id, table],
    queryFn: () =>
      api<Snapshot>(`/services/${service.id}/database/inspect${table ? '?table=' + table : ''}`),
    enabled: isDatabase,
    retry: false,
    refetchInterval: 15000,
  })
  if (!isDatabase)
    return (
      <p className="panel p-6 text-sm text-muted [background:light-dark(#f4f4f5,_#131315)] [border:1px_solid_light-dark(#e4e4e7,_#28282c)] [border-radius:8px] [box-shadow:0_1px_0_#ffffff04_inset,_0_8px_24px_#0000000d]">
        Database inspection is available for PostgreSQL and Redis services.
      </p>
    )
  const s = query.data?.stats
  return (
    <div className="min-w-0 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Database size={18} className="text-orange-300" />
          <h2>
            {service.spec.workload.kind === 'redis-service'
              ? 'Redis overview'
              : 'Database overview'}
          </h2>
          <span className="chip [&[data-state=succeeded]]:[color:#9bd2a8] [&[data-state=succeeded]]:[background:light-dark(#e4e4e7,_#18271d)] [&[data-state=succeeded]]:[border-color:#2d4a35] [&[data-state=failed]]:[color:#ffaaa1] [&[data-state=failed]]:[background:light-dark(#e4e4e7,_#2a1919)] [&[data-state=failed]]:[border-color:#4b2a2a] [&[data-state=interrupted]]:[color:#ffaaa1] [&[data-state=interrupted]]:[background:light-dark(#e4e4e7,_#2a1919)] [&[data-state=interrupted]]:[border-color:#4b2a2a] [&[data-state=running]]:[color:#ffb282] [&[data-state=running]]:[background:#2c1c12] [&[data-state=running]]:[border-color:#4e3120] [&[data-state=queued]]:[color:#ffb282] [&[data-state=queued]]:[background:#2c1c12] [&[data-state=queued]]:[border-color:#4e3120] [display:inline-flex] [align-items:center] [gap:6px] [border:1px_solid_light-dark(#d4d4d8,_#38383c)] [background:light-dark(#e4e4e7,_#1b1b1e)] [color:light-dark(#27272a,_#c3c3ca)] [font-size:10px] [padding:5px_8px] [border-radius:5px] [white-space:nowrap]">
            Read only
          </span>
        </div>
        <Button disabled={query.isFetching} onClick={() => void query.refetch()}>
          <RefreshCw size={14} />
          {query.isFetching ? 'Refreshing…' : 'Refresh'}
        </Button>
      </div>
      {query.error && (
        <p
          role="alert"
          className="error-notice [border:1px_solid_#4d2b2d] [background:light-dark(#f4f4f5,_#231719)] [border-radius:7px] [padding:18px] [font-size:12px] [color:#ffb4ae] [line-height:1.8] [overflow-wrap:anywhere] [&_p]:[margin-top:5px]"
        >
          {query.error.message}
          {query.data ? ' Showing the last successful snapshot below.' : ''}
        </p>
      )}
      {query.isPending && (
        <p
          role="status"
          className="panel p-6 text-sm text-muted [background:light-dark(#f4f4f5,_#131315)] [border:1px_solid_light-dark(#e4e4e7,_#28282c)] [border-radius:8px] [box-shadow:0_1px_0_#ffffff04_inset,_0_8px_24px_#0000000d]"
        >
          Reading database statistics…
        </p>
      )}
      {query.data && s && (
        <>
          <p className="text-xs text-muted">
            Updated {new Date(query.data.observedAt).toLocaleTimeString()} · refreshes every 15
            seconds
          </p>
          {query.data.engine === 'postgres' ? (
            <PostgresInspection snapshot={query.data} service={service} table={table} />
          ) : (
            <RedisInspection snapshot={query.data} />
          )}
        </>
      )}
    </div>
  )
}
