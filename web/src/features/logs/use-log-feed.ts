import type { UIEvent } from 'react'
import { logMessage } from './log-format'
import type { Page, Filters } from './log-types'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from '../../api-client'

export function useLogFeed({ serviceId, filters }: { serviceId: string; filters: Filters }) {
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

  function loadOlder() {
    setPaused(true)
    follow.current = false
    older.mutate()
  }
  function onScroll(event: UIEvent<HTMLDivElement>) {
    const el = event.currentTarget
    follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
  }

  return {
    paused,
    setPaused,
    expanded,
    setExpanded,
    output,
    onScroll,
    loadOlder,
    logs,
    older,
    structure,
    columnCount,
    timeline,
  }
}
export type LogFeedState = ReturnType<typeof useLogFeed>
