import { LogRow } from './log-row'

import type { LogFeedState } from './use-log-feed'

export function LogTable({
  output,
  onScroll,
  structure,
  timeline,
  columnCount,
  expanded,
  setExpanded,
  selectField,
}: Pick<
  LogFeedState,
  'output' | 'onScroll' | 'structure' | 'timeline' | 'columnCount' | 'expanded' | 'setExpanded'
> & { selectField: (field: string, value: string) => void }) {
  return (
    <div
      className="build-log runtime-log"
      aria-label="Application output"
      ref={output}
      onScroll={onScroll}
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
              <LogRow
                key={l.sequence}
                l={l}
                structure={structure}
                expanded={expanded}
                setExpanded={setExpanded}
                columnCount={columnCount}
                selectField={selectField}
              />
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
