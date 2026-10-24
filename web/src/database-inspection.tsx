import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useSearch } from '@tanstack/react-router'
import { tableFeatures, useTable, type ColumnDef } from '@tanstack/react-table'
import { Database, RefreshCw } from 'lucide-react'
import { api, type Service } from './api'
import { Button } from './ui'

type Row = Record<string, string | number | boolean | null>
interface Snapshot {
  engine: 'postgres' | 'redis'
  observed_at: string
  stats: Row
  tables?: Row[]
  tables_truncated?: boolean
  table?: {
    schema: string
    name: string
    columns: Row[]
    indexes: Row[]
    indexes_truncated: boolean
  } | null
  keyspaces?: Row[]
}
const features = tableFeatures({})
function number(value: unknown) {
  return typeof value === 'number' ? value.toLocaleString() : '—'
}
function bytes(value: unknown) {
  if (typeof value !== 'number') return '—'
  if (value < 1024) return `${value} B`
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KiB`
  return `${(value / 1024 ** 2).toFixed(1)} MiB`
}
function ratio(hits: unknown, misses: unknown) {
  return typeof hits === 'number' && typeof misses === 'number' && hits + misses > 0
    ? `${((100 * hits) / (hits + misses)).toFixed(1)}%`
    : '—'
}
function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="panel min-w-0 p-5">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-3 text-2xl font-medium tabular-nums">{value}</p>
      <p className="mt-2 text-xs text-muted">{hint}</p>
    </div>
  )
}
type Field = { key: string; label: string; format?: (value: unknown) => string }
const columnFields: Field[] = [
  { key: 'name', label: 'Column' },
  { key: 'type', label: 'Type' },
  { key: 'nullable', label: 'Nullable' },
  { key: 'primary_key', label: 'Primary key' },
  { key: 'identity', label: 'Identity' },
  { key: 'generated', label: 'Generated' },
]
const indexFields: Field[] = [
  { key: 'name', label: 'Index' },
  { key: 'method', label: 'Method' },
  { key: 'unique', label: 'Unique' },
  { key: 'primary_key', label: 'Primary key' },
  { key: 'valid', label: 'Valid' },
  { key: 'size_bytes', label: 'Size', format: bytes },
]
const tableFields: Field[] = [
  { key: 'name', label: 'Table' },
  { key: 'schema', label: 'Schema' },
  { key: 'kind', label: 'Kind' },
  { key: 'estimated_rows', label: 'Estimated rows', format: number },
  { key: 'table_bytes', label: 'Table size', format: bytes },
  { key: 'index_bytes', label: 'Index size', format: bytes },
]
const keyspaceFields: Field[] = [
  { key: 'name', label: 'Keyspace' },
  { key: 'keys', label: 'Keys', format: number },
  { key: 'expires', label: 'Keys with expiry', format: number },
  { key: 'avg_ttl_ms', label: 'Average TTL (ms)', format: number },
]
function DataTable({
  title,
  data,
  fields,
  empty,
  serviceId,
}: {
  title: string
  data: Row[]
  fields: Field[]
  empty: string
  serviceId?: string
}) {
  const columns = useMemo<ColumnDef<typeof features, Row>[]>(
    () =>
      fields.map((f) => ({
        accessorKey: f.key,
        header: f.label,
        cell: ({ row }) =>
          serviceId && f.key === 'name' ? (
            <Link
              className="text-orange-300 underline-offset-4 hover:underline"
              to="/services/$serviceId/overview"
              params={{ serviceId }}
              search={{ table: Number(row.original.id) }}
              resetScroll={false}
            >
              {String(row.original.name)}
            </Link>
          ) : f.format ? (
            f.format(row.original[f.key])
          ) : typeof row.original[f.key] === 'boolean' ? (
            row.original[f.key] ? (
              'Yes'
            ) : (
              'No'
            )
          ) : (
            String(row.original[f.key] ?? '—')
          ),
      })),
    [fields, serviceId],
  )
  const table = useTable({ key: title, features, data, columns })
  return (
    <section className="panel min-w-0 overflow-hidden">
      <h3 className="border-b border-zinc-800 px-5 py-4 text-sm font-medium">{title}</h3>
      <div
        className="max-h-[32rem] overflow-auto"
        role="region"
        aria-label={`${title}, scroll for more columns`}
        tabIndex={0}
      >
        <table
          className="w-full min-w-[600px] border-collapse text-left text-xs"
          aria-label={title}
        >
          <thead className="sticky top-0 bg-[#171719] text-muted">
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id}>
                {group.headers.map((header) => (
                  <th key={header.id} scope="col" className="px-5 py-3 font-medium">
                    <table.FlexRender header={header} />
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr key={row.id} className="border-t border-zinc-800/70">
                {row.getAllCells().map((cell) => (
                  <td key={cell.id} className="max-w-80 break-words px-5 py-3 tabular-nums">
                    <table.FlexRender cell={cell} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.length === 0 && <p className="p-5 text-xs text-muted">{empty}</p>}
    </section>
  )
}
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
            Updated {new Date(query.data.observed_at).toLocaleTimeString()} · refreshes every 15
            seconds
          </p>
          {query.data.engine === 'postgres' ? (
            <>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <Stat label="Database size" value={bytes(s.size_bytes)} hint={String(s.database)} />
                <Stat
                  label="Connections"
                  value={number(s.connections)}
                  hint={`${number(s.active_connections)} active · excludes this inspector`}
                />
                <Stat
                  label="Buffer cache hits"
                  value={typeof s.cache_hit_percent === 'number' ? s.cache_hit_percent + '%' : '—'}
                  hint="Since the last statistics reset"
                />
                <Stat
                  label="Transactions committed"
                  value={number(s.commits)}
                  hint={`${number(s.rollbacks)} rolled back · ${number(s.deadlocks)} deadlocks`}
                />
              </div>
              <DataTable
                title="Tables"
                fields={tableFields}
                data={query.data.tables ?? []}
                empty="No application tables yet. Run your application's migrations to create its schema."
                serviceId={service.id}
              />
              <p className="text-xs leading-relaxed text-muted">
                Row counts are PostgreSQL estimates; “—” means no estimate yet. Sizes are per
                relation; partitioned parents do not include their children.
                {query.data.tables_truncated ? ' Showing the first 200 tables.' : ''}
              </p>
              {table && !query.data.table && (
                <p role="status" className="panel p-5 text-sm text-muted">
                  This table no longer exists or cannot be inspected.
                </p>
              )}
              {query.data.table && (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h3 className="break-all text-sm font-medium">
                      {query.data.table.schema}.{query.data.table.name}
                    </h3>
                    <Link
                      className="text-xs text-muted hover:text-white"
                      to="/services/$serviceId/overview"
                      params={{ serviceId: service.id }}
                      search={{}}
                      resetScroll={false}
                    >
                      Close table details
                    </Link>
                  </div>
                  <DataTable
                    title="Columns"
                    fields={columnFields}
                    data={query.data.table.columns}
                    empty="This table has no columns."
                  />
                  <DataTable
                    title="Indexes"
                    fields={indexFields}
                    data={query.data.table.indexes}
                    empty="No indexes on this table."
                  />
                  {query.data.table.indexes_truncated && (
                    <p className="text-xs text-muted">Showing the first 100 indexes.</p>
                  )}
                </div>
              )}
            </>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <Stat
                  label="Memory used"
                  value={bytes(s.used_memory)}
                  hint={`Limit ${s.maxmemory === 0 ? 'unlimited' : bytes(s.maxmemory)} · peak ${bytes(s.used_memory_peak)}`}
                />
                <Stat
                  label="Connected clients"
                  value={number(s.connected_clients)}
                  hint={`${number(s.blocked_clients)} blocked · includes inspector`}
                />
                <Stat
                  label="Commands / second"
                  value={number(s.instantaneous_ops_per_sec)}
                  hint={`${number(s.total_commands_processed)} processed since start`}
                />
                <Stat
                  label="Cache hit rate"
                  value={ratio(s.keyspace_hits, s.keyspace_misses)}
                  hint={`${number(s.keyspace_hits)} hits · ${number(s.keyspace_misses)} misses`}
                />
              </div>
              <DataTable
                title="Keyspaces"
                fields={keyspaceFields}
                data={query.data.keyspaces ?? []}
                empty="No keys stored yet."
              />
              <section className="panel p-5">
                <h3 className="text-sm font-medium">Persistence and eviction</h3>
                <dl className="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
                  {[
                    [
                      'Append-only file',
                      s.aof_enabled === 1 ? 'Enabled' : s.aof_enabled === 0 ? 'Disabled' : '—',
                    ],
                    ['Last AOF write', s.aof_last_write_status ?? '—'],
                    ['Last AOF rewrite', s.aof_last_bgrewrite_status ?? '—'],
                    [
                      'AOF rewrite',
                      s.aof_rewrite_in_progress === 1
                        ? 'In progress'
                        : s.aof_rewrite_in_progress === 0
                          ? 'Idle'
                          : '—',
                    ],
                    ['Last snapshot', s.rdb_last_bgsave_status ?? '—'],
                    ['Process memory (RSS)', bytes(s.used_memory_rss)],
                    ['Evicted keys', number(s.evicted_keys)],
                    ['Expired keys', number(s.expired_keys)],
                  ].map(([label, value]) => (
                    <div key={String(label)}>
                      <dt className="text-xs text-muted">{label}</dt>
                      <dd className="mt-2 text-sm tabular-nums">{value}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            </>
          )}
        </>
      )}
    </div>
  )
}
