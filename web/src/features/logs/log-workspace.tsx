import { LogFeed } from './log-feed'
import type { Filters } from './log-types'
import { Button } from '../../components/button'
import { Input } from '../../components/input'
import { Select } from '../../components/select'
import { Field } from '../../components/field'
import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { api } from '../../api-client'
import type { Service } from '../../generated/model/service'
import { useRuntime } from '../../runtime-query'

export function LogWorkspace({ service, instance }: { service: Service; instance: string }) {
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
