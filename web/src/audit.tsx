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
import { api } from './api'
import { projectsQuery } from './projects'
import { Button, Input, Select } from './ui'

interface Entry {
  sequence: number
  timestamp: string
  actor: string
  action: string
  outcome: string
  target_type: string | null
  target_id: string | null
  project: string | null
  environment: string | null
  request_id: string | null
  details: Record<string, unknown>
}
interface Page {
  entries: Entry[]
  next_cursor: number | null
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
const compact = 'min-h-8 h-8 rounded px-2 py-1 text-[11px] font-normal'

export function AuditLog() {
  // Table owns the column filter and expansion state; the API filters the complete history.
  const [data, setData] = useState<Entry[]>([])
  const table = useTable({
    key: 'audit-log',
    features,
    columns,
    data,
    manualFiltering: true,
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
    getNextPageParam: (page) => page.next_cursor ?? undefined,
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
  const filterControl = (id: string) => {
    switch (id) {
      case 'timestamp':
        return (
          <details className="relative font-normal">
            <summary
              className={cn(
                'flex min-h-8 cursor-pointer list-none items-center rounded border border-zinc-700 px-2 text-[11px] text-zinc-400 hover:text-zinc-200',
                (draft.from || draft.until) && 'border-orange-400/40 text-orange-300',
              )}
            >
              {draft.from || draft.until ? 'Date range selected' : 'Any time'}{' '}
              <ChevronDown size={12} className="ml-auto" />
            </summary>
            <div className="absolute left-0 top-10 z-30 w-64 space-y-3 rounded-md border border-zinc-700 bg-[light-dark(#f4f4f5,#171719)] p-3 shadow-xl">
              <label className="block space-y-1">
                <span>From</span>
                <Input
                  aria-label="Audit from"
                  type="datetime-local"
                  className={compact}
                  value={draft.from}
                  onChange={(event) => set('from', event.target.value)}
                />
              </label>
              <label className="block space-y-1">
                <span>Until</span>
                <Input
                  aria-label="Audit until"
                  type="datetime-local"
                  className={compact}
                  value={draft.until}
                  onChange={(event) => set('until', event.target.value)}
                />
              </label>
            </div>
          </details>
        )
      case 'action':
      case 'actor':
        return (
          <Input
            aria-label={`Filter ${id}`}
            className={compact}
            maxLength={128}
            placeholder={`All ${id === 'action' ? 'actions' : 'actors'}`}
            value={draft[id]}
            onChange={(event) => set(id, event.target.value)}
          />
        )
      case 'project':
        return (
          <Select
            aria-label="Filter project"
            className={compact}
            value={draft.project}
            onChange={(event) => set('project', event.target.value)}
          >
            <option value="">All projects</option>
            {projects.data?.items.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </Select>
        )
      case 'environment':
        return (
          <Select
            aria-label="Filter environment"
            className={compact}
            disabled={!draft.project}
            value={draft.environment}
            onChange={(event) => set('environment', event.target.value)}
          >
            <option value="">All environments</option>
            {environments.data?.environments.map((environment) => (
              <option key={environment.id} value={environment.id}>
                {environment.name}
              </option>
            ))}
          </Select>
        )
      case 'outcome':
        return (
          <Select
            aria-label="Filter outcome"
            className={compact}
            value={draft.outcome}
            onChange={(event) => set('outcome', event.target.value)}
          >
            <option value="">All outcomes</option>
            {['requested', 'succeeded', 'failed', 'committed', 'recorded'].map((outcome) => (
              <option key={outcome}>{outcome}</option>
            ))}
          </Select>
        )
      default:
        return null
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
                          {filterControl(header.column.id)}
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
                              {row.original.target_type} {row.original.target_id ?? '—'}
                            </dd>
                          </div>
                          <div>
                            <dt className="mb-1 text-zinc-400">Action ID</dt>
                            <dd>{row.original.request_id ?? 'Platform change'}</dd>
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
