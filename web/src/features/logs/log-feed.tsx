import { LogFeedNotices } from './log-feed-notices'
import { LogFeedControls } from './log-feed-controls'
import { LogTable } from './log-table'

import { useLogFeed } from './use-log-feed'

import type { Filters } from './log-types'

import { Terminal } from 'lucide-react'

export function LogFeed({
  serviceId,
  filters,
  hasInstances,
  selectField,
}: {
  serviceId: string
  filters: Filters
  hasInstances: boolean
  selectField: (field: string, value: string) => void
}) {
  const {
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
  } = useLogFeed({ serviceId, filters })
  return (
    <>
      <LogFeedControls
        paused={paused}
        setPaused={setPaused}
        logs={logs}
        older={older}
        loadOlder={loadOlder}
      />
      <LogFeedNotices logs={logs} older={older} structure={structure} />
      {logs.data?.entries.length ||
      (timeline.length &&
        !filters.search &&
        !filters.level &&
        !filters.field &&
        !filters.stream) ? (
        <LogTable
          output={output}
          onScroll={onScroll}
          structure={structure}
          timeline={timeline}
          columnCount={columnCount}
          expanded={expanded}
          setExpanded={setExpanded}
          selectField={selectField}
        />
      ) : (
        <div className="console-empty">
          <Terminal size={24} />
          <h3>{hasInstances ? 'No matching log entries' : 'No running instances'}</h3>
          <p>
            {hasInstances
              ? 'Try a wider time range or fewer filters. New matching output appears automatically.'
              : 'Deploy a built image to start collecting application output.'}
          </p>
        </div>
      )}
    </>
  )
}
