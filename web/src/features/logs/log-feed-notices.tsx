import type { LogFeedState } from './use-log-feed'
export function LogFeedNotices({
  logs,
  older,
  structure,
}: Pick<LogFeedState, 'logs' | 'older' | 'structure'>) {
  return (
    <>
      {(logs.error || older.error) && (
        <p className="error-notice" role="alert">
          {(logs.error || older.error)?.message}
        </p>
      )}
      {logs.data?.archiveWarning && (
        <p className="error-notice" role="status">
          {logs.data.archiveWarning}
        </p>
      )}
      {(logs.data?.entries.length ?? 0) >= 5000 && (
        <p className="text-xs text-muted">
          Showing 5,000 entries. Narrow the time range or filters to inspect more history.
        </p>
      )}
      {structure.extra > 0 && (
        <p className="text-xs text-muted">
          Showing the first 12 structured fields. Expand a row to see all fields.
        </p>
      )}
    </>
  )
}
