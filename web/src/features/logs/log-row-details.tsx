import { logMessage, flatFields } from './log-format'
import type { Log } from './log-types'
import { Button } from '../../components/button'

export function LogRowDetails({
  l,
  selectField,
}: {
  l: Log
  selectField: (field: string, value: string) => void
}) {
  return (
    <div
      className="log-detail [padding:16px_20px] [border-bottom:1px_solid_light-dark(#e4e4e7,_#29292d)] [background:light-dark(#f4f4f5,_#161618)] [font-size:11px]"
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
          <div className="log-field-list [display:grid] [gap:1px] [&_button]:[display:grid] [&_button]:[grid-template-columns:minmax(90px,_1fr)_3fr] [&_button]:[gap:16px] [&_button]:[text-align:left] [&_button]:[padding:5px_8px] [&_button]:[background:light-dark(#e4e4e7,_#1c1c1f)] [&_button]:[overflow-wrap:anywhere] [&_button]:[cursor:pointer] [&_button:hover]:[background:light-dark(#e4e4e7,_#25252a)] [&_button_span]:[color:light-dark(#52525b,_#9999a4)]">
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
  )
}
