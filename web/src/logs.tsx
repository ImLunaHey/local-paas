import { Button } from './components/button'
import { Input } from './components/input'
import { Select } from './components/select'
import { Field } from './components/field'
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useSearch } from '@tanstack/react-router'
import { ChevronRight, Pause, Play, Terminal } from 'lucide-react'
import { cn } from 'cn'
import { api } from './api-client'
import type { Service } from './generated/model/service'
import { useRuntime } from './runtime-query'

interface Log {
  sequence: number
  instanceId: string
  node: string
  revisionId: string
  timestamp: string
  stream: string
  line: string
  level: string
  message: string
  fields: Record<string, unknown> | null
}
interface Marker {
  id: string
  timestamp: string
  message: string
  instanceId: string | null
}
interface Page {
  markers?: Marker[]
  entries: Log[]
  nextCursor: number
  oldestCursor: number | null
  hasMore: boolean
  archiveWarning: string | null
}
interface Filters {
  search: string
  level: string
  stream: string
  instanceId: string
  field: string
  value: string
  from: string
  until: string
}
const empty: Filters = {
  search: '',
  level: '',
  stream: '',
  instanceId: '',
  field: '',
  value: '',
  from: '',
  until: '',
}
export function LogViewer({ service }: { service: Service }) {
  const search = useSearch({ strict: false }) as { instance?: string }
  return (
    <LogWorkspace
      key={service.id + (search.instance ?? '')}
      service={service}
      instance={search.instance ?? ''}
    />
  )
}
function LogWorkspace({ service, instance }: { service: Service; instance: string }) {
  const runtime = useRuntime(service.id)
  const [draft, setDraft] = useState({ ...empty, instanceId: instance })
  const [filters, setFilters] = useState({ ...empty, instanceId: instance })
  const storage = useQuery({
    queryKey: ['log-storage'],
    queryFn: () =>
      api<{
        available: boolean
        configured: boolean
        pendingEntries: number
        bytesOnDisk: number | null
        retention: string
      }>('/log-storage'),
    refetchInterval: 15000,
  })
  useEffect(() => {
    const timeout = window.setTimeout(() => {
      if (
        (draft.from && !Number.isFinite(Date.parse(draft.from))) ||
        (draft.until && !Number.isFinite(Date.parse(draft.until)))
      )
        return
      if (!/^[A-Za-z0-9_.]*$/.test(draft.field)) return
      setFilters(draft)
    }, 250)
    return () => window.clearTimeout(timeout)
  }, [draft])
  const set = (key: keyof Filters, value: string) => {
    const next = { ...draft, [key]: value }
    setDraft(next)
    if (['level', 'stream', 'instanceId'].includes(key)) setFilters({ ...filters, [key]: value })
  }
  return (
    <section className="panel p-5 space-y-4" aria-label="Runtime logs">
      <div className="section-heading">
        <div>
          <h2>Runtime logs</h2>
        </div>
        <span className="chip">
          {storage.data?.available ? 'ClickHouse connected' : 'Archive unavailable'}
        </span>
      </div>
      <form
        className="log-filters space-y-3"
        onSubmit={(e) => {
          e.preventDefault()
          setFilters({ ...draft })
        }}
      >
        <div className="log-toolbar">
          <label className="field log-search">
            <span className="sr-only">Search logs</span>
            <Input
              aria-label="Search logs"
              value={draft.search}
              onChange={(e) => set('search', e.target.value)}
              placeholder="Message or any JSON field"
              maxLength={512}
            />
          </label>
          <label className="field">
            <span className="sr-only">Level</span>
            <Select
              aria-label="Level"
              value={draft.level}
              onChange={(e) => set('level', e.target.value)}
            >
              <option value="">All levels</option>
              {['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'unclassified'].map((l) => (
                <option key={l}>{l}</option>
              ))}
            </Select>
          </label>
          <label className="field">
            <span className="sr-only">Stream</span>
            <Select
              aria-label="Stream"
              value={draft.stream}
              onChange={(e) => set('stream', e.target.value)}
            >
              <option value="">stdout + stderr</option>
              <option>stdout</option>
              <option>stderr</option>
            </Select>
          </label>
          <div className="flex gap-2">
            <Button
              type="button"
              onClick={() => {
                setDraft(empty)
                setFilters(empty)
              }}
            >
              Clear
            </Button>
          </div>{' '}
        </div>
        {filters.instanceId && (
          <div className="text-xs text-muted">
            Showing instance <code>{filters.instanceId}</code>
          </div>
        )}
        <details className="log-advanced">
          <summary>
            More filters
            {[filters.instanceId, filters.field, filters.from, filters.until].filter(Boolean).length
              ? ' · active'
              : ''}
          </summary>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 pt-3">
            <Field label="Instance" className="sm:col-span-2">
              <Select
                aria-label="Log instance"
                value={draft.instanceId}
                onChange={(e) => set('instanceId', e.target.value)}
              >
                <option value="">All instances</option>
                {draft.instanceId &&
                  !runtime.data?.instances.some((i) => i.id === draft.instanceId) && (
                    <option value={draft.instanceId}>
                      Archived · {draft.instanceId.slice(0, 8)}
                    </option>
                  )}
                {runtime.data?.instances.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.nodeName} · {i.id.slice(0, 8)} · {i.state}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="JSON field">
              <Input
                value={draft.field}
                onChange={(e) => set('field', e.target.value)}
                placeholder="request.id"
                maxLength={128}
                pattern="[A-Za-z0-9_.]*"
              />
            </Field>
            <Field label="Field equals">
              <Input
                value={draft.value}
                onChange={(e) => set('value', e.target.value)}
                placeholder="Exact value"
                maxLength={512}
              />
            </Field>
            <Field label="From">
              <Input
                type="datetime-local"
                value={draft.from}
                onChange={(e) => set('from', e.target.value)}
              />
            </Field>
            <Field label="Until">
              <Input
                type="datetime-local"
                value={draft.until}
                onChange={(e) => set('until', e.target.value)}
              />
            </Field>
          </div>
        </details>
      </form>
      <LogFeed
        key={service.id + JSON.stringify(filters)}
        serviceId={service.id}
        filters={filters}
        hasInstances={!!runtime.data?.instances.length}
        selectField={(field, value) => {
          const next = { ...filters, field, value }
          setDraft(next)
          setFilters(next)
        }}
      />
      <div className="flex flex-wrap gap-3 text-xs text-muted">
        <span>
          {storage.data?.retention ?? 'No automatic expiry'} ·{' '}
          {storage.data?.bytesOnDisk == null
            ? 'Storage usage unavailable'
            : (storage.data.bytesOnDisk / 1048576).toFixed(2) + ' MiB on disk'}
        </span>
        <span>{storage.data?.pendingEntries ?? '—'} entries awaiting archival</span>
      </div>

      {!runtime.data?.instances.length && (
        <Link
          className="back-link"
          to="/services/$serviceId/builds"
          params={{ serviceId: service.id }}
        >
          View build output
        </Link>
      )}
    </section>
  )
}
// oxlint-disable-next-line react-doctor/no-giant-component, react-doctor/no-high-complexity-react-function -- Existing view retained during tooling migration; decomposition is a separate refactor.
function LogFeed({
  serviceId,
  filters,
  hasInstances,
  selectField,
}: {
  serviceId: string
  filters: Filters
  hasInstances: boolean
  selectField: (field: string, value: string) => void
}) {
  const client = useQueryClient()
  const key = ['runtime-logs', serviceId, filters]
  const [paused, setPaused] = useState(false)
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set())
  const output = useRef<HTMLDivElement>(null)
  const follow = useRef(true)
  const query = (cursor?: { after?: number; before?: number }) => {
    const params = new URLSearchParams()
    Object.entries(filters).forEach(([name, value]) => {
      if (value || (name === 'value' && filters.field))
        params.set(
          name,
          name === 'from' || name === 'until' ? new Date(value).toISOString() : value,
        )
    })
    Object.entries(cursor ?? {}).forEach(([name, value]) => params.set(name, String(value)))
    return api<Page>('/services/' + serviceId + '/runtime/logs?' + params)
  }
  const merge = (old: Page, incoming: Page, older = false): Page => {
    const unique = new Map([...old.entries, ...incoming.entries].map((l) => [l.sequence, l]))
    const entries = [...unique.values()].sort((a, b) => a.sequence - b.sequence).slice(-5000)
    return {
      ...incoming,
      markers: [
        ...new Map(
          [...(old.markers ?? []), ...(incoming.markers ?? [])].map((m) => [m.id, m]),
        ).values(),
      ],
      entries,
      nextCursor: Math.max(old.nextCursor, incoming.nextCursor),
      oldestCursor: entries[0]?.sequence ?? null,
      hasMore: older ? incoming.hasMore : old.hasMore,
    }
  }
  const logs = useQuery({
    queryKey: key,
    queryFn: async () => {
      const old = client.getQueryData<Page>(key)
      const incoming = await query(old ? { after: old.nextCursor } : undefined)
      return old ? merge(old, incoming) : incoming
    },
    refetchInterval: paused ? false : 3000,
    refetchOnWindowFocus: !paused,
  })
  const older = useMutation({
    mutationFn: () => query({ before: logs.data?.oldestCursor ?? 0 }),
    onSuccess: (page) => {
      client.setQueryData<Page>(key, (old) => (old ? merge(old, page, true) : page))
    },
  })
  useEffect(() => {
    if (output.current && follow.current && !paused)
      output.current.scrollTop = output.current.scrollHeight
  }, [logs.data?.nextCursor, paused])
  const structure = useMemo(() => {
    const fields = new Set<string>()
    let message = false
    for (const log of logs.data?.entries ?? []) {
      if (logMessage(log) !== null) message = true
      for (const [name, value] of Object.entries(log.fields ?? {})) {
        if (['msg', 'message'].includes(name) && typeof value === 'string') continue
        if (['level', 'severity', 'severity_text'].includes(name) && log.level !== 'unclassified')
          continue
        fields.add(name)
      }
    }
    // Bound the table width for arbitrary application JSON; details retain every field.
    return { columns: [...fields].slice(0, 12), extra: Math.max(0, fields.size - 12), message }
  }, [logs.data?.entries])
  const columnCount = 4 + structure.columns.length + Number(structure.message)
  const first = logs.data?.entries[0]
  const timeline = [
    ...(logs.data?.entries ?? []).map((log) => ({
      kind: 'log' as const,
      timestamp: log.timestamp,
      log,
    })),
    ...(logs.data?.markers ?? [])
      .filter((m) => !first || Date.parse(m.timestamp) >= Date.parse(first.timestamp) - 120000)
      .map((marker) => ({ kind: 'marker' as const, timestamp: marker.timestamp, marker })),
  ].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
  return (
    <>
      <div className="flex flex-wrap justify-between items-center gap-3">
        <span className="text-xs text-muted">
          {paused ? 'Paused' : 'Following · updates every 3 seconds'}
        </span>
        <div className="flex gap-2">
          <Button
            disabled={
              !logs.data?.hasMore || older.isPending || (logs.data?.entries.length ?? 0) >= 5000
            }
            onClick={() => {
              setPaused(true)
              follow.current = false
              older.mutate()
            }}
          >
            Load older
          </Button>
          <Button onClick={() => setPaused(!paused)}>
            {paused ? <Play size={14} /> : <Pause size={14} />}
            {paused ? 'Resume live logs' : 'Pause live logs'}
          </Button>
        </div>
      </div>
      {(logs.error || older.error) && (
        <p className="error-notice" role="alert">
          {(logs.error || older.error)?.message}
        </p>
      )}
      {logs.data?.archiveWarning && (
        <p className="error-notice" role="status">
          {logs.data.archiveWarning}
        </p>
      )}
      {(logs.data?.entries.length ?? 0) >= 5000 && (
        <p className="text-xs text-muted">
          Showing 5,000 entries. Narrow the time range or filters to inspect more history.
        </p>
      )}
      {structure.extra > 0 && (
        <p className="text-xs text-muted">
          Showing the first 12 structured fields. Expand a row to see all fields.
        </p>
      )}
      {logs.data?.entries.length ||
      (timeline.length &&
        !filters.search &&
        !filters.level &&
        !filters.field &&
        !filters.stream) ? (
        <div
          className="build-log runtime-log"
          aria-label="Application output"
          ref={output}
          onScroll={(e) => {
            const el = e.currentTarget
            follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
          }}
        >
          <table className="runtime-log-table" aria-label="Runtime log entries">
            <thead>
              <tr>
                {[
                  'Time',
                  'Level',
                  'Stream',
                  'Instance',
                  ...structure.columns,
                  ...(structure.message ? ['Message'] : []),
                ].map((name, index) => (
                  <th
                    key={
                      (index < 4
                        ? 'metadata:'
                        : index < 4 + structure.columns.length
                          ? 'field:'
                          : 'message:') + name
                    }
                    scope="col"
                    title={name}
                  >
                    {name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {timeline.map((entry) => {
                if (entry.kind === 'marker')
                  return (
                    <tr key={entry.marker.id}>
                      <td colSpan={columnCount}>
                        <div className="log-lifecycle">
                          <time>{new Date(entry.timestamp).toLocaleTimeString('en-GB')}</time>
                          <span>{entry.marker.message}</span>
                        </div>
                      </td>
                    </tr>
                  )
                const l = entry.log
                return (
                  <Fragment key={l.sequence}>
                    <tr className="runtime-log-row" data-level={l.level}>
                      <td>
                        <Button
                          variant="ghost"
                          className="min-h-0 gap-1 p-0 text-[11px] font-normal text-muted"
                          aria-label={'Expand log ' + l.sequence}
                          aria-expanded={expanded.has(l.sequence)}
                          aria-controls={'log-detail-' + l.sequence}
                          onClick={() =>
                            setExpanded((old) => {
                              const next = new Set(old)
                              if (next.has(l.sequence)) next.delete(l.sequence)
                              else next.add(l.sequence)
                              return next
                            })
                          }
                        >
                          <ChevronRight
                            size={12}
                            className={cn(
                              'shrink-0 transition-transform',
                              expanded.has(l.sequence) && 'rotate-90',
                            )}
                          />
                          <time
                            dateTime={l.timestamp}
                            title={new Date(l.timestamp).toLocaleString()}
                          >
                            {new Date(l.timestamp).toLocaleTimeString('en-GB', { hour12: false })}
                          </time>
                        </Button>
                      </td>
                      <td className="log-level">{l.level === 'unclassified' ? '—' : l.level}</td>
                      <td className="log-stream">{l.stream}</td>
                      <td className="log-instance" title={l.node + ' / ' + l.instanceId}>
                        {l.instanceId.slice(0, 8)}
                      </td>
                      {structure.columns.map((field) => {
                        const value =
                          l.fields && Object.hasOwn(l.fields, field) ? l.fields[field] : undefined
                        const text =
                          value === undefined
                            ? '—'
                            : typeof value === 'string'
                              ? value
                              : JSON.stringify(value)
                        return (
                          <td
                            key={field}
                            className={cn('log-value', value === undefined && 'text-muted')}
                            title={text}
                          >
                            {text}
                          </td>
                        )
                      })}
                      {structure.message && (
                        <td className="log-value" title={logMessage(l) ?? undefined}>
                          {logMessage(l) ?? '—'}
                        </td>
                      )}
                    </tr>
                    {expanded.has(l.sequence) && (
                      <tr id={'log-detail-' + l.sequence}>
                        <td colSpan={columnCount}>
                          <div
                            className="log-detail"
                            role="region"
                            aria-label={'Log ' + l.sequence + ' details'}
                          >
                            <div className="text-muted mb-3">
                              {new Date(l.timestamp).toLocaleString()} · {l.node} · {l.instanceId}
                            </div>
                            <pre>{logMessage(l)}</pre>
                            {l.fields && (
                              <>
                                <pre>{JSON.stringify(l.fields, null, 2)}</pre>
                                <h4 className="mt-4 mb-2 text-muted">Structured fields</h4>
                                <div className="log-field-list">
                                  {flatFields(l.fields).map(([field, value]) => (
                                    <Button
                                      key={field}
                                      title={'Filter ' + field}
                                      onClick={() => selectField(field, value)}
                                    >
                                      <span>{field}</span>
                                      <code>{value}</code>
                                    </Button>
                                  ))}
                                </div>
                              </>
                            )}
                            <details className="mt-3 text-muted">
                              <summary>Original output</summary>
                              <pre>{l.line}</pre>
                            </details>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="console-empty">
          <Terminal size={24} />
          <h3>{hasInstances ? 'No matching log entries' : 'No running instances'}</h3>
          <p>
            {hasInstances
              ? 'Try a wider time range or fewer filters. New matching output appears automatically.'
              : 'Deploy a built image to start collecting application output.'}
          </p>
        </div>
      )}
    </>
  )
}
function logMessage(log: Log): string | null {
  if (!log.fields) return log.message || log.line || ' '
  if (typeof log.fields.msg === 'string') return log.fields.msg
  if (typeof log.fields.message === 'string') return log.fields.message
  return null
}
function flatFields(object: Record<string, unknown>, prefix = '', depth = 0): [string, string][] {
  return Object.entries(object).flatMap(([key, value]) => {
    const path = prefix ? prefix + '.' + key : key
    if (value && typeof value === 'object' && !Array.isArray(value) && depth < 5)
      return flatFields(value as Record<string, unknown>, path, depth + 1)
    return value !== null && typeof value !== 'object' && /^[A-Za-z0-9_.]+$/.test(path)
      ? [[path, String(value)]]
      : []
  })
}
