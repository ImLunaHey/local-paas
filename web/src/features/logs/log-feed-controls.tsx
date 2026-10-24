import { Button } from '../../components/button'
import { Pause, Play } from 'lucide-react'
import type { LogFeedState } from './use-log-feed'

export function LogFeedControls({
  paused,
  setPaused,
  logs,
  older,
  loadOlder,
}: Pick<LogFeedState, 'paused' | 'setPaused' | 'logs' | 'older' | 'loadOlder'>) {
  return (
    <div className="flex flex-wrap justify-between items-center gap-3">
      <span className="text-xs text-muted">
        {paused ? 'Paused' : 'Following · updates every 3 seconds'}
      </span>
      <div className="flex gap-2">
        <Button
          disabled={
            !logs.data?.hasMore || older.isPending || (logs.data?.entries.length ?? 0) >= 5000
          }
          onClick={loadOlder}
        >
          Load older
        </Button>
        <Button onClick={() => setPaused(!paused)}>
          {paused ? <Play size={14} /> : <Pause size={14} />}
          {paused ? 'Resume live logs' : 'Pause live logs'}
        </Button>
      </div>
    </div>
  )
}
