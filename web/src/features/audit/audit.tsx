import { AuditColumnFilter } from './audit-column-filter'
import { Fragment, useEffect, useMemo, useState } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import {
  columnFilteringFeature,
  rowExpandingFeature,
  tableFeatures,
  useTable,
  type ColumnDef,
} from '@tanstack/react-table'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { cn } from 'cn'
import { api } from '../../api-client'
import { projectsQuery } from '../../projects-query'
import { Button } from '../../components/button'

interface Entry {
  sequence: number
  timestamp: string
  actor: string
  action: string
  outcome: string
  targetType: string | null
  targetId: string | null
  project: string | null
  environment: string | null
  requestId: string | null
  details: Record<string, unknown>
}
interface Page {
  entries: Entry[]
  nextCursor: number | null
}
const features = tableFeatures({ columnFilteringFeature, rowExpandingFeature })
const columns: ColumnDef<typeof features, Entry>[] = [
  {
    id: 'details',
    header: '',
    enableColumnFilter: false,
    cell: ({ row }) => (
      <Button
        variant="ghost"
        className="min-h-8 size-8 p-0"
        aria-label={`Details for audit entry ${row.original.sequence}`}
        aria-expanded={row.getIsExpanded()}
        aria-controls={`audit-details-${row.id}`}
        onClick={row.getToggleExpandedHandler()}
      >
        {row.getIsExpanded() ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </Button>
    ),
  },
  {
    accessorKey: 'timestamp',
    header: 'Time',
    cell: ({ row }) => (
      <time
        dateTime={row.original.timestamp}
        className="whitespace-nowrap tabular-nums text-zinc-400"
      >
        {new Date(row.original.timestamp).toLocaleString()}
      </time>
    ),
  },
  {
    accessorKey: 'action',
    header: 'Action',
    cell: ({ row }) => <span className="font-medium text-zinc-200">{row.original.action}</span>,
  },
  { accessorKey: 'actor', header: 'Actor' },
  {
    accessorKey: 'project',
    header: 'Project',
    cell: ({ row }) => row.original.project ?? 'Workspace',
  },
  {
    accessorKey: 'environment',
    header: 'Environment',
    cell: ({ row }) => row.original.environment ?? '—',
  },
  {
    accessorKey: 'outcome',
    header: 'Outcome',
    cell: ({ row }) => (
      <span
        className={cn(
          'inline-flex rounded border border-zinc-700/70 bg-zinc-800/40 px-2 py-1 text-[11px]',
          row.original.outcome === 'failed' && 'border-red-500/20 bg-red-500/10 text-red-300',
          row.original.outcome === 'succeeded' &&
            'border-emerald-500/20 bg-emerald-500/10 text-emerald-300',
        )}
      >
        {row.original.outcome}
      </span>
    ),
  },
]
const empty = {
  project: '',
  environment: '',
  action: '',
  actor: '',
  outcome: '',
  from: '',
  until: '',
}

export function AuditLog() {
  // Table owns the column filter and expansion state; the API filters the complete history.
  const [data, setData] = useState<Entry[]>([])
  const table = useTable({
    key: 'audit-log',
    features,
    columns,
    data,
    manualFiltering: true,
    // The API owns filtering; no auto-selected client filter registry is needed.
    defaultColumn: { filterFn: () => true },
    getRowId: (entry) => String(entry.sequence),
    getRowCanExpand: () => true,
  })
  const columnFilters = table.state.columnFilters
  const draft = useMemo(() => {
    const values = Object.fromEntries(columnFilters.map((filter) => [filter.id, filter.value]))
    const range = values.timestamp as { from?: string; until?: string } | undefined
    return {
      project: String(values.project ?? ''),
      environment: String(values.environment ?? ''),
      action: String(values.action ?? ''),
      actor: String(values.actor ?? ''),
      outcome: String(values.outcome ?? ''),
      from: range?.from ?? '',
      until: range?.until ?? '',
    }
  }, [columnFilters])
  const [filters, setFilters] = useState(empty)
  useEffect(() => {
    const timer = setTimeout(() => setFilters(draft), 250)
    return () => clearTimeout(timer)
  }, [draft])
  const projects = useQuery(projectsQuery)
  const environments = useQuery({
    queryKey: ['projects', draft.project],
    queryFn: () =>
      api<{ environments: { id: string; name: string }[] }>('/projects/' + draft.project),
    enabled: !!draft.project,
  })
  const logs = useInfiniteQuery({
    queryKey: ['audit', filters],
    initialPageParam: null as number | null,
    queryFn: ({ pageParam }) => {
      const q = new URLSearchParams()
      for (const [key, value] of Object.entries(filters)) {
        if (value)
          q.set(key, ['from', 'until'].includes(key) ? new Date(value).toISOString() : value)
      }
      if (pageParam) q.set('before', String(pageParam))
      return api<Page>('/audit?' + q)
    },
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    refetchInterval: 10000,
  })
  useEffect(() => {
    setData(logs.data?.pages.flatMap((page) => page.entries) ?? [])
  }, [logs.data])
  const set = (key: keyof typeof empty, value: string) => {
    table.setExpanded({})
    if (key === 'from' || key === 'until') {
      table
        .getColumn('timestamp')!
        .setFilterValue({ from: draft.from, until: draft.until, [key]: value })
    } else {
      table.setColumnFilters((previous) => [
        ...previous.filter(
          (filter) => filter.id !== key && !(key === 'project' && filter.id === 'environment'),
        ),
        ...(value ? [{ id: key, value }] : []),
      ])
    }
  }

  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">WORKSPACE</div>
          <h1>Audit log</h1>
          <p>Configuration changes, deployments and other platform actions.</p>
        </div>
      </div>
      <section className="panel min-w-0 overflow-hidden" aria-label="Audit log">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 px-4 py-3">
          <p className="text-xs text-muted" role="status">
            {logs.isFetching ? 'Updating…' : `${data.length} entries loaded`} · newest first
          </p>
          <Button
            variant="ghost"
            className="min-h-8 px-2 py-1"
            disabled={!Object.values(draft).some(Boolean)}
            onClick={() => {
              table.resetColumnFilters()
              table.setExpanded({})
            }}
          >
            Clear filters
          </Button>
        </div>
        {logs.error && (
          <p role="alert" className="error-notice m-4">
            {logs.error.message}
          </p>
        )}
        <div
          className="max-h-[70vh] overflow-auto"
          // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Keyboard users must be able to scroll this overflow region.
          tabIndex={0}
          role="region"
          aria-label="Audit table, scroll for more columns"
        >
          <table
            className="w-full min-w-[1060px] border-collapse text-left text-xs"
            aria-label="Audit entries"
            aria-busy={logs.isFetching}
          >
            <thead className="sticky top-0 z-10 bg-[light-dark(#f4f4f5,#161618)]">
              {table.getHeaderGroups().map((group) => (
                <tr key={group.id}>
                  {group.headers.map((header) => (
                    <th
                      key={header.id}
                      scope="col"
                      className={cn(
                        'border-b border-zinc-800 px-3 pt-4 pb-3 align-top font-medium text-zinc-400',
                        header.column.id === 'details'
                          ? 'w-10 px-2'
                          : header.column.id === 'action'
                            ? 'min-w-56'
                            : 'min-w-36',
                      )}
                    >
                      {header.column.id === 'details' ? (
                        <span className="sr-only">Details</span>
                      ) : (
                        <div className="space-y-3">
                          <div>
                            <table.FlexRender header={header} />
                          </div>
                          <AuditColumnFilter
                            id={header.column.id}
                            draft={draft}
                            set={set}
                            projects={projects}
                            environments={environments}
                          />
                        </div>
                      )}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.map((row) => (
                <Fragment key={row.id}>
                  <tr
                    data-audit-entry
                    className={cn(
                      'border-b border-zinc-800/70 text-zinc-400 hover:bg-white/[0.025]',
                      row.getIsExpanded() && 'bg-white/[0.025]',
                    )}
                  >
                    {row.getAllCells().map((cell) => (
                      // oxlint-disable-next-line react-doctor/control-has-associated-label -- TanStack FlexRender supplies cell content; cells are not interactive controls.
                      <td
                        key={cell.id}
                        className={cn(
                          'px-3 py-3 align-middle',
                          cell.column.id === 'details' && 'px-2',
                          cell.column.id === 'actor' && 'max-w-56 break-all',
                        )}
                      >
                        <table.FlexRender cell={cell} />
                      </td>
                    ))}
                  </tr>
                  {row.getIsExpanded() && (
                    <tr id={`audit-details-${row.id}`}>
                      <td
                        colSpan={columns.length}
                        className="border-b border-zinc-800 bg-zinc-950/50 px-6 py-4"
                      >
                        <dl className="grid gap-3 text-xs text-zinc-400 sm:grid-cols-2">
                          <div>
                            <dt className="mb-1 text-zinc-400">Target</dt>
                            <dd className="break-all">
                              {row.original.targetType} {row.original.targetId ?? '—'}
                            </dd>
                          </div>
                          <div>
                            <dt className="mb-1 text-zinc-400">Action ID</dt>
                            <dd>{row.original.requestId ?? 'Platform change'}</dd>
                          </div>
                        </dl>
                        <pre className="mt-4 whitespace-pre-wrap break-all text-[11px] text-zinc-400">
                          {JSON.stringify(row.original.details, null, 2)}
                        </pre>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
              {!data.length && (
                <tr>
                  <td colSpan={columns.length} className="px-6 py-12 text-center text-zinc-400">
                    {logs.isPending
                      ? 'Loading audit entries…'
                      : logs.error
                        ? 'Could not load audit entries.'
                        : 'No matching audit entries.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-zinc-800 px-4 py-3">
          <p className="max-w-2xl text-[11px] leading-relaxed text-zinc-400">
            Updates every 10 seconds. Actions identify the private API caller or node; individual
            administrator accounts are not available yet.
          </p>
          {logs.hasNextPage && (
            <Button disabled={logs.isFetchingNextPage} onClick={() => void logs.fetchNextPage()}>
              Older entries
            </Button>
          )}
        </div>
      </section>
    </>
  )
}
