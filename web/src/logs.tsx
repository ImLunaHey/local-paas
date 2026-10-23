import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useSearch } from '@tanstack/react-router'
import { Pause, Play, Terminal } from 'lucide-react'
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
  const [draft, setDraft] = useState({ ...empty, instance_id: instance })
  const [filters, setFilters] = useState({ ...empty, instance_id: instance })
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
    if (['level', 'stream', 'instance_id'].includes(key)) setFilters({ ...filters, [key]: value })
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
            <input
              aria-label="Search logs"
              value={draft.search}
              onChange={(e) => set('search', e.target.value)}
              placeholder="Message or any JSON field"
              maxLength={512}
            />
          </label>
          <label className="field">
            <span className="sr-only">Level</span>
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
            <span className="sr-only">Stream</span>
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
          <div className="flex gap-2">
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
          </div>{' '}
        </div>
        {filters.instance_id && (
          <div className="text-xs text-muted">
            Showing instance <code>{filters.instance_id}</code>
          </div>
        )}
        <details className="log-advanced">
          <summary>
            More filters
            {[filters.instance_id, filters.field, filters.from, filters.until].filter(Boolean)
              .length
              ? ' · active'
              : ''}
          </summary>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 pt-3">
            <label className="field sm:col-span-2">
              Instance
              <select
                aria-label="Log instance"
                value={draft.instance_id}
                onChange={(e) => set('instance_id', e.target.value)}
              >
                <option value="">All instances</option>
                {draft.instance_id &&
                  !runtime.data?.instances.some((i) => i.id === draft.instance_id) && (
                    <option value={draft.instance_id}>
                      Archived · {draft.instance_id.slice(0, 8)}
                    </option>
                  )}
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
          {storage.data?.bytes_on_disk == null
            ? 'Storage usage unavailable'
            : (storage.data.bytes_on_disk / 1048576).toFixed(2) + ' MiB on disk'}
        </span>
        <span>{storage.data?.pending_entries ?? '—'} entries awaiting archival</span>
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
          <div className="log-line log-columns" aria-hidden="true">
            <span>Time</span>
            <span>Level</span>
            <span className="log-stream">Stream</span>
            <span className="log-instance">Instance</span>
            <span>Message</span>
          </div>
          {logs.data.entries.map((l) => (
            <details key={l.sequence} className="runtime-log-row" data-level={l.level}>
              <summary className="log-line" aria-label={'Expand log ' + l.sequence}>
                <time dateTime={l.timestamp} title={new Date(l.timestamp).toLocaleString()}>
                  {new Date(l.timestamp).toLocaleTimeString('en-GB', { hour12: false })}
                </time>
                <span className="log-level">{l.level === 'unclassified' ? '—' : l.level}</span>
                <span className="log-stream">{l.stream}</span>
                <span className="log-instance" title={l.node + ' / ' + l.instance_id}>
                  {l.instance_id.slice(0, 8)}
                </span>
                <span className="log-message">{l.message || l.line || ' '}</span>
              </summary>
              <div className="log-detail">
                <div className="text-muted mb-3">
                  {new Date(l.timestamp).toLocaleString()} · {l.node} · {l.instance_id}
                </div>
                <pre>{l.message || l.line}</pre>
                {l.fields && (
                  <>
                    <h4 className="mt-4 mb-2 text-muted">Structured fields</h4>
                    <div className="log-field-list">
                      {flatFields(l.fields).map(([field, value]) => (
                        <button
                          key={field}
                          title={'Filter ' + field}
                          onClick={() => selectField(field, value)}
                        >
                          <span>{field}</span>
                          <code>{value}</code>
                        </button>
                      ))}
                    </div>
                  </>
                )}
                <details className="mt-3 text-muted">
                  <summary>Original output</summary>
                  <pre>{l.line}</pre>
                </details>
              </div>
            </details>
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
