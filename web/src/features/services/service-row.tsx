import { sourceDescription, requestedCapacity } from './service-presentation'

import { ServiceTrends } from '../../metrics'

import { cn } from 'cn'

import { Link } from '@tanstack/react-router'
import { Box, ChevronRight, Circle, Workflow } from 'lucide-react'

import type { Service } from '../../generated/model/service'

import { useRuntime, runtimeLabel } from '../../runtime-query'

export function ServiceRow({ service }: { service: Service }) {
  const { spec } = service
  const runtime = useRuntime(service.id, spec.workload.kind !== 'celld-service')
  return (
    <Link to="/services/$serviceId" params={{ serviceId: service.id }} className="service-row">
      <div className="flex items-center gap-3 min-w-0">
        <span className="service-icon">
          {spec.workload.kind === 'oci-service' ? <Box size={19} /> : <Workflow size={19} />}
        </span>
        <div className="min-w-0">
          <h3>{spec.name}</h3>
          <p className="truncate">
            {spec.project} / {spec.environment}
            <span className="mx-2">·</span>
            {sourceDescription(spec)}
          </p>
        </div>
      </div>
      <span className="text-xs text-muted">{requestedCapacity(spec.workload)}</span>
      <ServiceTrends service={service} instances={runtime.data?.instances ?? []} />
      <span className="flex items-center justify-between gap-4">
        <span
          className={cn(
            'chip',
            runtimeLabel(runtime.data) === 'Running' &&
              '!border-emerald-400/20 !bg-emerald-400/10 !text-emerald-300',
          )}
        >
          <Circle size={9} />
          {spec.workload.kind === 'celld-service'
            ? 'Fleet not deployed'
            : runtime.isError
              ? 'Status unavailable'
              : runtimeLabel(runtime.data)}
        </span>
        <ChevronRight size={16} className="text-muted" />
      </span>
    </Link>
  )
}
