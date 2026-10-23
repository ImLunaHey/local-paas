import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Pause, Play, Search, Terminal } from 'lucide-react'
import { api, type Service } from './api'
import { useRuntime } from './runtime'

interface Log {
  sequence: number
  instance_id: string
  node: string
  revision_id: string
  timestamp: string
  stream: string
  line: string
  level: string
  message: string
  fields: Record<string, unknown> | null
}
interface Page {
  entries: Log[]
  next_cursor: number
  oldest_cursor: number | null
  has_more: boolean
  archive_warning: string | null
}
interface Filters {
  search: string
  level: string
  stream: string
  instance_id: string
  field: string
  value: string
  from: string
  until: string
}
const empty: Filters = {
  search: '',
  level: '',
  stream: '',
  instance_id: '',
  field: '',
  value: '',
  from: '',
  until: '',
}
export function LogViewer({ service }: { service: Service }) {
  const runtime = useRuntime(service.id)
  const [draft, setDraft] = useState(empty)
  const [filters, setFilters] = useState(empty)
  const storage = useQuery({
    queryKey: ['log-storage'],
    queryFn: () =>
      api<{
        available: boolean
        configured: boolean
        pending_entries: number
        bytes_on_disk: number | null
        retention: string
      }>('/log-storage'),
    refetchInterval: 15000,
  })
  const set = (key: keyof Filters, value: string) => setDraft((old) => ({ ...old, [key]: value }))
  return (
    <section className="panel p-6 space-y-5" aria-label="Runtime logs">
      <div className="section-heading">
        <div>
          <h2>Runtime logs</h2>
          <p className="text-xs text-muted mt-2">
            Structured events and plain text · stdout and stderr
          </p>
        </div>
        <span className="chip">
          {storage.data?.available ? 'ClickHouse connected' : 'Archive unavailable'}
        </span>
      </div>
      <form
        className="log-filters grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
        onSubmit={(e) => {
          e.preventDefault()
          setFilters({ ...draft })
        }}
      >
        <label className="field sm:col-span-2">
          Search logs
          <input
            aria-label="Search logs"
            value={draft.search}
            onChange={(e) => set('search', e.target.value)}
            placeholder="Message or any JSON field"
            maxLength={512}
          />
        </label>
        <label className="field">
          Level
          <select
            aria-label="Level"
            value={draft.level}
            onChange={(e) => set('level', e.target.value)}
          >
            <option value="">All levels</option>
            {['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'unclassified'].map((l) => (
              <option key={l}>{l}</option>
            ))}
          </select>
        </label>
        <label className="field">
          Stream
          <select
            aria-label="Stream"
            value={draft.stream}
            onChange={(e) => set('stream', e.target.value)}
          >
            <option value="">stdout + stderr</option>
            <option>stdout</option>
            <option>stderr</option>
          </select>
        </label>
        <label className="field sm:col-span-2">
          Instance
          <select
            aria-label="Log instance"
            value={draft.instance_id}
            onChange={(e) => set('instance_id', e.target.value)}
          >
            <option value="">All instances</option>
            {runtime.data?.instances.map((i) => (
              <option key={i.id} value={i.id}>
                {i.node_name} · {i.id.slice(0, 8)} · {i.state}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          JSON field
          <input
            value={draft.field}
            onChange={(e) => set('field', e.target.value)}
            placeholder="request.id"
            maxLength={128}
            pattern="[A-Za-z0-9_.]*"
          />
        </label>
        <label className="field">
          Field equals
          <input
            value={draft.value}
            onChange={(e) => set('value', e.target.value)}
            placeholder="Exact value"
            maxLength={512}
          />
        </label>
        <label className="field">
          From
          <input
            type="datetime-local"
            value={draft.from}
            onChange={(e) => set('from', e.target.value)}
          />
        </label>
        <label className="field">
          Until
          <input
            type="datetime-local"
            value={draft.until}
            onChange={(e) => set('until', e.target.value)}
          />
        </label>
        <div className="flex gap-2 items-end sm:col-span-2">
          <button className="button primary" type="submit">
            <Search size={14} /> Apply filters
          </button>
          <button
            className="button"
            type="button"
            onClick={() => {
              setDraft(empty)
              setFilters(empty)
            }}
          >
            Clear
          </button>
        </div>
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
          {storage.data?.bytes_on_disk == null
            ? 'Storage usage unavailable'
            : (storage.data.bytes_on_disk / 1048576).toFixed(2) + ' MiB on disk'}
        </span>
        <span>{storage.data?.pending_entries ?? '—'} entries awaiting archival</span>
      </div>
      <p className="text-xs text-muted">
        Severity is read from structured level/severity fields. Plain text stays unclassified;
        stderr is a stream, not an error level. Persistent storage still needs independent backups.
      </p>
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
      entries,
      next_cursor: Math.max(old.next_cursor, incoming.next_cursor),
      oldest_cursor: entries[0]?.sequence ?? null,
      has_more: older ? incoming.has_more : old.has_more,
    }
  }
  const logs = useQuery({
    queryKey: key,
    queryFn: async () => {
      const old = client.getQueryData<Page>(key)
      const incoming = await query(old ? { after: old.next_cursor } : undefined)
      return old ? merge(old, incoming) : incoming
    },
    refetchInterval: paused ? false : 3000,
    refetchOnWindowFocus: !paused,
  })
  const older = useMutation({
    mutationFn: () => query({ before: logs.data?.oldest_cursor ?? 0 }),
    onSuccess: (page) => {
      client.setQueryData<Page>(key, (old) => (old ? merge(old, page, true) : page))
    },
  })
  useEffect(() => {
    if (output.current && follow.current && !paused)
      output.current.scrollTop = output.current.scrollHeight
  }, [logs.data?.next_cursor, paused])
  return (
    <>
      <div className="flex flex-wrap justify-between items-center gap-3">
        <span className="text-xs text-muted">
          {paused ? 'Paused' : 'Following · updates every 3 seconds'}
        </span>
        <div className="flex gap-2">
          <button
            className="button"
            disabled={
              !logs.data?.has_more || older.isPending || (logs.data?.entries.length ?? 0) >= 5000
            }
            onClick={() => {
              setPaused(true)
              follow.current = false
              older.mutate()
            }}
          >
            Load older
          </button>
          <button className="button" onClick={() => setPaused(!paused)}>
            {paused ? <Play size={14} /> : <Pause size={14} />}
            {paused ? 'Resume live logs' : 'Pause live logs'}
          </button>
        </div>
      </div>
      {(logs.error || older.error) && (
        <p className="error-notice" role="alert">
          {(logs.error || older.error)?.message}
        </p>
      )}
      {logs.data?.archive_warning && (
        <p className="error-notice" role="status">
          {logs.data.archive_warning}
        </p>
      )}
      {(logs.data?.entries.length ?? 0) >= 5000 && (
        <p className="text-xs text-muted">
          Showing 5,000 entries. Narrow the time range or filters to inspect more history.
        </p>
      )}
      {logs.data?.entries.length ? (
        <div
          className="build-log runtime-log"
          aria-label="Application output"
          ref={output}
          onScroll={(e) => {
            const el = e.currentTarget
            follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
          }}
        >
          {logs.data.entries.map((l) => (
            <article key={l.sequence} className="runtime-log-row" data-level={l.level}>
              <div className="flex flex-wrap items-center gap-2 text-muted">
                <time dateTime={l.timestamp}>{new Date(l.timestamp).toLocaleString()}</time>
                <span>
                  {l.node} / {l.instance_id.slice(0, 8)}
                </span>
                <span className="chip">{l.stream}</span>
                {l.level !== 'unclassified' && <span className="log-level">{l.level}</span>}
              </div>
              <pre>{l.message || l.line}</pre>
              {l.fields && (
                <details>
                  <summary className="cursor-pointer text-muted text-xs">Structured fields</summary>
                  <div className="flex flex-wrap gap-2 my-2">
                    {flatFields(l.fields)
                      .slice(0, 24)
                      .map(([field, value]) => (
                        <button
                          key={field}
                          className="chip"
                          title={'Filter ' + field}
                          onClick={() => selectField(field, value)}
                        >
                          {field}: {value.slice(0, 100)}
                        </button>
                      ))}
                  </div>
                  <pre>{JSON.stringify(l.fields, null, 2)}</pre>
                  <details>
                    <summary>Original output</summary>
                    <pre>{l.line}</pre>
                  </details>
                </details>
              )}
            </article>
          ))}
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
