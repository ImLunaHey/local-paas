import { workloadDescription } from './service-presentation'

import { cn } from 'cn'

import { Link } from '@tanstack/react-router'
import { Circle } from 'lucide-react'

import type { Service } from '../../generated/model/service'

import { useRuntime, runtimeLabel } from '../../runtime-query'

export function ServiceHeader({
  spec,
  runtime,
  serviceId,
}: {
  spec: Service['spec']
  runtime: ReturnType<typeof useRuntime>
  serviceId: string
}) {
  return (
    <div className="page-heading">
      <div>
        <div className="eyebrow">
          {spec.project} / {spec.environment}
        </div>
        <h1>{spec.name}</h1>
        <p>{workloadDescription(spec.workload)}</p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {spec.workload.kind === 'oci-service' &&
        spec.workload.execution === 'worker' ? null : runtime.data?.previewUrl ? (
          <a
            className="button primary"
            href={runtime.data.previewUrl}
            target="_blank"
            rel="noreferrer"
          >
            Open app ↗
          </a>
        ) : (
          <Link className="button" to="/services/$serviceId/networking" params={{ serviceId }}>
            {spec.workload.kind === 'postgres-service' || spec.workload.kind === 'redis-service'
              ? 'Database connections'
              : 'Set up URL'}
          </Link>
        )}
        <span
          className={cn(
            'chip',
            !runtime.isError &&
              runtimeLabel(runtime.data) === 'Running' &&
              '!border-emerald-400/20 !bg-emerald-400/10 !text-emerald-300',
          )}
        >
          <Circle size={10} />
          {runtime.isError ? 'Runtime status unavailable' : runtimeLabel(runtime.data)}
        </span>
      </div>
    </div>
  )
}
