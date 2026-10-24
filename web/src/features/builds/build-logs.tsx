import type { LogPage, AccumulatedLogs } from './build-log-types'

import { Button } from '../../components/button'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { api } from '../../api-client'

import type { Build } from '../../api'

export function BuildLogs({ build }: { build: Build }) {
  const client = useQueryClient()
  const queryKey = ['build-logs', build.id]
  const logs = useQuery({
    queryKey,
    queryFn: async () => {
      const result = {
        ...(client.getQueryData<AccumulatedLogs>(queryKey) ?? {
          text: '',
          cursor: 0,
          truncated: false,
        }),
      }
      for (let page = 0; page < 32; page++) {
        const chunk = await api<LogPage>(`/builds/${build.id}/logs?after=${result.cursor}`)
        result.text += chunk.entries.map((entry) => entry.message).join('')
        result.cursor = chunk.nextCursor
        result.truncated = chunk.truncated
        if (chunk.entries.length < 128) break
      }
      return result
    },
    refetchInterval: 2000,
  })
  return (
    <div>
      <div className="flex justify-between items-center mb-3">
        <h3>Build output</h3>
        <Button
          className="text-muted"
          aria-label="Refresh build logs"
          onClick={() => {
            void logs.refetch()
          }}
        >
          <RefreshCw size={14} />
        </Button>
      </div>
      {logs.isError && (
        <p className="error-notice mb-3" role="alert">
          {logs.error.message}
        </p>
      )}
      <pre className="build-log" aria-label="Build output">
        {logs.data?.text || (logs.isPending ? 'Loading build output…' : 'No build output yet.')}
      </pre>
      {logs.data?.truncated && (
        <p className="text-xs text-muted mt-2">
          Output reached its storage limit. Remaining output was discarded; build execution can
          continue.
        </p>
      )}
    </div>
  )
}
