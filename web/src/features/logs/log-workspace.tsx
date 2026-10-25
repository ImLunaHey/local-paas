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
    <section
      className="panel p-5 space-y-4 [background:light-dark(#f4f4f5,_#131315)] [border:1px_solid_light-dark(#e4e4e7,_#28282c)] [border-radius:8px] [box-shadow:0_1px_0_#ffffff04_inset,_0_8px_24px_#0000000d]"
      aria-label="Runtime logs"
    >
      <div className="section-heading [display:flex] [justify-content:space-between] [align-items:center] [margin-bottom:15px] [gap:12px] max-[720px]:[&_.tiny-label]:[font-size:8px] max-[720px]:[&_.tiny-label]:[letter-spacing:0.6px]">
        <div>
          <h2>Runtime logs</h2>
        </div>
        <span className="chip [&[data-state=succeeded]]:[color:#9bd2a8] [&[data-state=succeeded]]:[background:light-dark(#e4e4e7,_#18271d)] [&[data-state=succeeded]]:[border-color:#2d4a35] [&[data-state=failed]]:[color:#ffaaa1] [&[data-state=failed]]:[background:light-dark(#e4e4e7,_#2a1919)] [&[data-state=failed]]:[border-color:#4b2a2a] [&[data-state=interrupted]]:[color:#ffaaa1] [&[data-state=interrupted]]:[background:light-dark(#e4e4e7,_#2a1919)] [&[data-state=interrupted]]:[border-color:#4b2a2a] [&[data-state=running]]:[color:#ffb282] [&[data-state=running]]:[background:#2c1c12] [&[data-state=running]]:[border-color:#4e3120] [&[data-state=queued]]:[color:#ffb282] [&[data-state=queued]]:[background:#2c1c12] [&[data-state=queued]]:[border-color:#4e3120] [display:inline-flex] [align-items:center] [gap:6px] [border:1px_solid_light-dark(#d4d4d8,_#38383c)] [background:light-dark(#e4e4e7,_#1b1b1e)] [color:light-dark(#27272a,_#c3c3ca)] [font-size:10px] [padding:5px_8px] [border-radius:5px] [white-space:nowrap]">
          {storage.data?.available ? 'ClickHouse connected' : 'Archive unavailable'}
        </span>
      </div>
      <form
        className="log-filters space-y-3 [&_input]:[min-width:0] [&_input]:[width:100%] [&_select]:[min-width:0] [&_select]:[width:100%]"
        onSubmit={(e) => {
          e.preventDefault()
          setFilters({ ...draft })
        }}
      >
        <div className="log-toolbar [display:flex] [gap:8px] [align-items:center] [flex-wrap:wrap] [&_.field]:[margin:0]">
          <label className="field log-search [display:block] [min-width:0] [&_>_span]:[display:block] [&_>_span]:[color:light-dark(#27272a,_#c3c3ca)] [&_>_span]:[font-size:11px] [&_>_span]:[margin-bottom:8px] [&_>_label]:[display:block] [&_>_label]:[color:light-dark(#27272a,_#c3c3ca)] [&_>_label]:[font-size:11px] [&_>_label]:[margin-bottom:8px] [&_input]:[width:100%] [&_input]:[background:light-dark(#f4f4f5,_#171719)] [&_input]:[border:1px_solid_light-dark(#d4d4d8,_#38383c)] [&_input]:[border-radius:5px] [&_input]:[padding:12px_13px] [&_input]:[font-size:12px] [&_input]:[color:light-dark(#27272a,_#e7e7eb)] [&_input::placeholder]:[color:light-dark(#52525b,_#8d8d95)] [&_small]:[display:block] [&_small]:[font-size:10px] [&_small]:[line-height:1.7] [&_small]:[color:light-dark(#52525b,_#8d8d95)] [&_small]:[margin-top:7px] [flex:1] [min-width:180px]">
            <span className="sr-only">Search logs</span>
            <Input
              aria-label="Search logs"
              value={draft.search}
              onChange={(e) => set('search', e.target.value)}
              placeholder="Message or any JSON field"
              maxLength={512}
            />
          </label>
          <label className="field [display:block] [min-width:0] [&_>_span]:[display:block] [&_>_span]:[color:light-dark(#27272a,_#c3c3ca)] [&_>_span]:[font-size:11px] [&_>_span]:[margin-bottom:8px] [&_>_label]:[display:block] [&_>_label]:[color:light-dark(#27272a,_#c3c3ca)] [&_>_label]:[font-size:11px] [&_>_label]:[margin-bottom:8px] [&_input]:[width:100%] [&_input]:[background:light-dark(#f4f4f5,_#171719)] [&_input]:[border:1px_solid_light-dark(#d4d4d8,_#38383c)] [&_input]:[border-radius:5px] [&_input]:[padding:12px_13px] [&_input]:[font-size:12px] [&_input]:[color:light-dark(#27272a,_#e7e7eb)] [&_input::placeholder]:[color:light-dark(#52525b,_#8d8d95)] [&_small]:[display:block] [&_small]:[font-size:10px] [&_small]:[line-height:1.7] [&_small]:[color:light-dark(#52525b,_#8d8d95)] [&_small]:[margin-top:7px]">
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
          <label className="field [display:block] [min-width:0] [&_>_span]:[display:block] [&_>_span]:[color:light-dark(#27272a,_#c3c3ca)] [&_>_span]:[font-size:11px] [&_>_span]:[margin-bottom:8px] [&_>_label]:[display:block] [&_>_label]:[color:light-dark(#27272a,_#c3c3ca)] [&_>_label]:[font-size:11px] [&_>_label]:[margin-bottom:8px] [&_input]:[width:100%] [&_input]:[background:light-dark(#f4f4f5,_#171719)] [&_input]:[border:1px_solid_light-dark(#d4d4d8,_#38383c)] [&_input]:[border-radius:5px] [&_input]:[padding:12px_13px] [&_input]:[font-size:12px] [&_input]:[color:light-dark(#27272a,_#e7e7eb)] [&_input::placeholder]:[color:light-dark(#52525b,_#8d8d95)] [&_small]:[display:block] [&_small]:[font-size:10px] [&_small]:[line-height:1.7] [&_small]:[color:light-dark(#52525b,_#8d8d95)] [&_small]:[margin-top:7px]">
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
        <details className="log-advanced [&_summary]:[cursor:pointer] [&_summary]:[color:var(--color-muted)] [&_summary]:[font-size:12px]">
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
          className="back-link [display:inline-flex] [gap:7px] [align-items:center] [font-size:11px] [color:light-dark(#52525b,_#a0a0a8)] [margin-bottom:25px] [&:hover]:[color:light-dark(#27272a,_#e7e7eb)]"
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
