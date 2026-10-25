import { number, bytes, columnFields, indexFields, tableFields } from './database-inspection-format'
import { DataTable } from './database-data-table'
import { Stat } from './database-stat'
import type { Snapshot } from './database-inspection-types'

import { Link } from '@tanstack/react-router'

import type { Service } from '../../generated/model/service'

export function PostgresInspection({
  snapshot,
  service,
  table,
}: {
  snapshot: Snapshot
  service: Service
  table?: number
}) {
  const s = snapshot.stats
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Database size" value={bytes(s.sizeBytes)} hint={String(s.database)} />
        <Stat
          label="Connections"
          value={number(s.connections)}
          hint={`${number(s.activeConnections)} active · excludes this inspector`}
        />
        <Stat
          label="Buffer cache hits"
          value={typeof s.cacheHitPercent === 'number' ? s.cacheHitPercent + '%' : '—'}
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
        data={snapshot.tables ?? []}
        empty="No application tables yet. Run your application's migrations to create its schema."
        serviceId={service.id}
      />
      <p className="text-xs leading-relaxed text-muted">
        Row counts are PostgreSQL estimates; “—” means no estimate yet. Sizes are per relation;
        partitioned parents do not include their children.
        {snapshot.tablesTruncated ? ' Showing the first 200 tables.' : ''}
      </p>
      {table && !snapshot.table && (
        <p
          role="status"
          className="panel p-5 text-sm text-muted [background:light-dark(#f4f4f5,_#131315)] [border:1px_solid_light-dark(#e4e4e7,_#28282c)] [border-radius:8px] [box-shadow:0_1px_0_#ffffff04_inset,_0_8px_24px_#0000000d]"
        >
          This table no longer exists or cannot be inspected.
        </p>
      )}
      {snapshot.table && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="break-all text-sm font-medium">
              {snapshot.table.schema}.{snapshot.table.name}
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
            data={snapshot.table.columns}
            empty="This table has no columns."
          />
          <DataTable
            title="Indexes"
            fields={indexFields}
            data={snapshot.table.indexes}
            empty="No indexes on this table."
          />
          {snapshot.table.indexesTruncated && (
            <p className="text-xs text-muted">Showing the first 100 indexes.</p>
          )}
        </div>
      )}
    </>
  )
}
