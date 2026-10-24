import { LogWorkspace } from './log-workspace'

import { useSearch } from '@tanstack/react-router'

import type { Service } from '../../generated/model/service'

export function LogViewer({ service }: { service: Service }) {
  const search = useSearch({ strict: false }) as { instance?: string }
  return (
    <LogWorkspace
      key={service.id + (search.instance ?? '')}
      service={service}
      instance={search.instance ?? ''}
    />
  )
}
