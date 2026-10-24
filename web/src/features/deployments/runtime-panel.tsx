import { LogViewer } from '../logs/logs'
import { MetricsViewer } from '../../metrics'

import type { Service } from '../../generated/model/service'

export function RuntimePanel({ service, view }: { service: Service; view: 'logs' | 'metrics' }) {
  return view === 'logs' ? <LogViewer service={service} /> : <MetricsViewer service={service} />
}
