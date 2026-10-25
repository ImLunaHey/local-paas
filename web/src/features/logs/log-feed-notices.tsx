import type { LogFeedState } from './use-log-feed'
export function LogFeedNotices({
  logs,
  older,
  structure,
}: Pick<LogFeedState, 'logs' | 'older' | 'structure'>) {
  return (
    <>
      {(logs.error || older.error) && (
        <p
          className="error-notice [border:1px_solid_#4d2b2d] [background:light-dark(#f4f4f5,_#231719)] [border-radius:7px] [padding:18px] [font-size:12px] [color:#ffb4ae] [line-height:1.8] [overflow-wrap:anywhere] [&_p]:[margin-top:5px]"
          role="alert"
        >
          {(logs.error || older.error)?.message}
        </p>
      )}
      {logs.data?.archiveWarning && (
        <p
          className="error-notice [border:1px_solid_#4d2b2d] [background:light-dark(#f4f4f5,_#231719)] [border-radius:7px] [padding:18px] [font-size:12px] [color:#ffb4ae] [line-height:1.8] [overflow-wrap:anywhere] [&_p]:[margin-top:5px]"
          role="status"
        >
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
