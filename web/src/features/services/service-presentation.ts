import type { ServiceSpec } from '../../generated/model/serviceSpec'
import type { Workload } from '../../generated/model/workload'
import { sourceLabel } from '../../api'
export function sourceDescription(spec: ServiceSpec): string {
  switch (spec.workload.kind) {
    case 'rustfs-service':
      return 'RustFS · S3 storage'
    case 'postgres-service':
      return 'PostgreSQL 18 · local volume'
    case 'redis-service':
      return 'Redis 8 · local volume'
    default:
      return sourceLabel(spec.source)
  }
}
export function workloadDescription(workload: Workload): string {
  switch (workload.kind) {
    case 'oci-service':
      return workload.execution === 'worker'
        ? 'Background worker · singleton'
        : 'Dockerfile service'
    case 'postgres-service':
      return 'PostgreSQL database'
    case 'redis-service':
      return 'Redis database'
    case 'rustfs-service':
      return 'RustFS S3 storage'
    case 'celld-service':
      return 'Dedicated celld application fleet'
  }
}
export function requestedCapacity(workload: Workload): string {
  switch (workload.kind) {
    case 'oci-service':
      return workload.execution === 'worker'
        ? 'Singleton background worker'
        : `${workload.replicas} requested replicas`
    case 'celld-service':
      return `${workload.members} requested members`
    default:
      return '1 pinned database'
  }
}
