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
      className="build-log runtime-log [max-height:340px] [overflow:auto] [white-space:pre-wrap] [overflow-wrap:anywhere] [background:light-dark(#fafafa,_#0b0b0d)] [border:1px_solid_light-dark(#e4e4e7,_#242427)] [border-radius:6px] [padding:16px] [font:11px/1.85_var(--font-mono)] [color:light-dark(#27272a,_#c3c3ca)] [min-height:280px] [max-height:520px] [padding:0] [background:light-dark(#fafafa,_#101011)] [&_pre]:[white-space:pre-wrap] [&_pre]:[overflow-wrap:anywhere] [&_pre]:[margin:0] [&_pre]:[font:inherit] [&_details_pre]:[padding-top:8px] [&_details_pre]:[color:light-dark(#52525b,_#a6a6ad)] [&_.chip]:[font-size:10px] [&_.chip]:[overflow-wrap:anywhere] [&_.chip]:[white-space:normal]"
      aria-label="Application output"
      ref={output}
      onScroll={onScroll}
    >
      <table
        className="runtime-log-table [width:100%] [border-collapse:separate] [border-spacing:0] [text-align:left] [white-space:normal] [&_th]:[padding:6px_14px] [&_th]:[line-height:20px] [&_th]:[font-size:10px] [&_th]:[white-space:nowrap] [&_th]:[max-width:320px] [&_th]:[overflow:hidden] [&_th]:[text-overflow:ellipsis] [&_th]:[position:sticky] [&_th]:[top:0] [&_th]:[z-index:1] [&_th]:[background:light-dark(#f4f4f5,_#18181b)] [&_th]:[border-bottom:1px_solid_light-dark(#d4d4d8,_#2b2b31)] [&_th]:[color:light-dark(#52525b,_#92929c)] [&_th]:[font-family:ui-sans-serif,_system-ui,_sans-serif] [&_th]:[font-weight:500] [&_th]:[cursor:default] [&_th]:[letter-spacing:0.03em] [&_td:not([colspan])]:[padding:6px_14px] [&_td:not([colspan])]:[line-height:20px] [&_td:not([colspan])]:[font-size:11px] [&_td:not([colspan])]:[white-space:nowrap] [&_td:not([colspan])]:[max-width:320px] [&_td:not([colspan])]:[overflow:hidden] [&_td:not([colspan])]:[text-overflow:ellipsis] [&_td[colspan]]:[padding:0] [&_time]:[color:light-dark(#52525b,_#85858e)]"
        aria-label="Runtime log entries"
      >
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
                    <div className="log-lifecycle [display:flex] [align-items:center] [gap:18px] [padding:10px_14px] [border-top:1px_solid_#4b3426] [border-bottom:1px_solid_#4b3426] [color:#e9ab86] [background:light-dark(#f4f4f5,_#231a15)] [font:500_11px/1.5_ui-sans-serif,_system-ui,_sans-serif] [&_time]:[color:#ac8c76] [&_time]:[font-variant-numeric:tabular-nums]">
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
