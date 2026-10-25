import { LogRowDetails } from './log-row-details'

import { logMessage } from './log-format'
import type { Log } from './log-types'
import { Button } from '../../components/button'

import { Fragment } from 'react'

import { ChevronRight } from 'lucide-react'
import { cn } from 'cn'

import type { LogFeedState } from './use-log-feed'

export function LogRow({
  l,
  structure,
  expanded,
  setExpanded,
  columnCount,
  selectField,
}: Pick<LogFeedState, 'structure' | 'expanded' | 'setExpanded' | 'columnCount'> & {
  l: Log
  selectField: (field: string, value: string) => void
}) {
  return (
    <Fragment key={l.sequence}>
      <tr
        className="runtime-log-row [&[data-level=error]_.log-level]:[color:#ff8585] [&[data-level=fatal]_.log-level]:[color:#ff8585] [&[data-level=warn]_.log-level]:[color:#e9b86e] [&[data-level=info]_.log-level]:[color:#8ab6a2] [&:hover]:[background:light-dark(#e4e4e7,_#1d1d20)] [&:focus-within]:[background:light-dark(#e4e4e7,_#1d1d20)]"
        data-level={l.level}
      >
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
            <time dateTime={l.timestamp} title={new Date(l.timestamp).toLocaleString()}>
              {new Date(l.timestamp).toLocaleTimeString('en-GB', { hour12: false })}
            </time>
          </Button>
        </td>
        <td className="log-level [color:light-dark(#52525b,_#aaaab2)] [font-size:10px] [text-transform:uppercase]">
          {l.level === 'unclassified' ? '—' : l.level}
        </td>
        <td className="log-stream [color:light-dark(#52525b,_#85858e)]">{l.stream}</td>
        <td
          className="log-instance [color:light-dark(#52525b,_#85858e)]"
          title={l.node + ' / ' + l.instanceId}
        >
          {l.instanceId.slice(0, 8)}
        </td>
        {structure.columns.map((field) => {
          const value = l.fields && Object.hasOwn(l.fields, field) ? l.fields[field] : undefined
          const text =
            value === undefined ? '—' : typeof value === 'string' ? value : JSON.stringify(value)
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
            <LogRowDetails l={l} selectField={selectField} />
          </td>
        </tr>
      )}
    </Fragment>
  )
}
