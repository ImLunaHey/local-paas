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
    <Link
      to="/services/$serviceId"
      params={{ serviceId: service.id }}
      className="service-row [display:grid] [grid-template-columns:minmax(150px,_1fr)_130px_100px_110px_150px] [gap:16px] [align-items:center] [padding:19px_22px] [&_+_.service-row]:[border-top:1px_solid_light-dark(#e4e4e7,_#28282c)] [&:hover]:[background:light-dark(#e4e4e7,_#1b1b1e)] [&_h3]:[font-size:13px] [&_h3]:[margin-bottom:6px] [&_p]:[font-size:10px] [&_p]:[color:light-dark(#52525b,_#a0a0a8)] max-[1100px]:[grid-template-columns:minmax(0,_1fr)_130px] max-[1100px]:[gap:10px] max-[1100px]:[&_>_:nth-child(2)]:[display:none] max-[720px]:[padding:18px_14px] max-[720px]:[grid-template-columns:minmax(0,_1fr)_minmax(0,_1fr)] max-[720px]:[&_.chip]:[font-size:8px] max-[720px]:[&_.service-icon]:[display:none] max-[1200px]:[grid-template-columns:minmax(140px,_1fr)_90px_100px_135px] max-[1200px]:[&_>_:nth-child(2)]:[display:none] max-[720px]:[&_>_:first-child]:[grid-column:1_/_-1] max-[720px]:[&_>_:last-child]:[grid-column:1_/_-1]"
    >
      <div className="flex items-center gap-3 min-w-0">
        <span className="service-icon [flex-shrink:0] [display:grid] [place-items:center] [width:39px] [height:40px] [border:1px_solid_light-dark(#d4d4d8,_#38383c)] [border-radius:8px] [background:light-dark(#e4e4e7,_#1b1b1e)] [color:light-dark(#27272a,_#c3c3ca)]">
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
            'chip [&[data-state=succeeded]]:[color:#9bd2a8] [&[data-state=succeeded]]:[background:light-dark(#e4e4e7,_#18271d)] [&[data-state=succeeded]]:[border-color:#2d4a35] [&[data-state=failed]]:[color:#ffaaa1] [&[data-state=failed]]:[background:light-dark(#e4e4e7,_#2a1919)] [&[data-state=failed]]:[border-color:#4b2a2a] [&[data-state=interrupted]]:[color:#ffaaa1] [&[data-state=interrupted]]:[background:light-dark(#e4e4e7,_#2a1919)] [&[data-state=interrupted]]:[border-color:#4b2a2a] [&[data-state=running]]:[color:#ffb282] [&[data-state=running]]:[background:#2c1c12] [&[data-state=running]]:[border-color:#4e3120] [&[data-state=queued]]:[color:#ffb282] [&[data-state=queued]]:[background:#2c1c12] [&[data-state=queued]]:[border-color:#4e3120] [display:inline-flex] [align-items:center] [gap:6px] [border:1px_solid_light-dark(#d4d4d8,_#38383c)] [background:light-dark(#e4e4e7,_#1b1b1e)] [color:light-dark(#27272a,_#c3c3ca)] [font-size:10px] [padding:5px_8px] [border-radius:5px] [white-space:nowrap]',
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
