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
    <div className="log-detail" role="region" aria-label={'Log ' + l.sequence + ' details'}>
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
  )
}
