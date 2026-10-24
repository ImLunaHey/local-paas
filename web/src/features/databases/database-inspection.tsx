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
      <p className="panel p-6 text-sm text-muted">
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
          <span className="chip">Read only</span>
        </div>
        <Button disabled={query.isFetching} onClick={() => void query.refetch()}>
          <RefreshCw size={14} />
          {query.isFetching ? 'Refreshing…' : 'Refresh'}
        </Button>
      </div>
      {query.error && (
        <p role="alert" className="error-notice">
          {query.error.message}
          {query.data ? ' Showing the last successful snapshot below.' : ''}
        </p>
      )}
      {query.isPending && (
        <p role="status" className="panel p-6 text-sm text-muted">
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
