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
        <p
          className="error-notice mb-3 [border:1px_solid_#4d2b2d] [background:light-dark(#f4f4f5,_#231719)] [border-radius:7px] [padding:18px] [font-size:12px] [color:#ffb4ae] [line-height:1.8] [overflow-wrap:anywhere] [&_p]:[margin-top:5px]"
          role="alert"
        >
          {logs.error.message}
        </p>
      )}
      <pre
        className="build-log [max-height:340px] [overflow:auto] [white-space:pre-wrap] [overflow-wrap:anywhere] [background:light-dark(#fafafa,_#0b0b0d)] [border:1px_solid_light-dark(#e4e4e7,_#242427)] [border-radius:6px] [padding:16px] [font:11px/1.85_var(--font-mono)] [color:light-dark(#27272a,_#c3c3ca)]"
        aria-label="Build output"
      >
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
