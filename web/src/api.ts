import type { Service, ServiceSpec, GitSource as Source } from './generated/model'
import { getGetServiceQueryOptions } from './generated/management'
export type { Service, ServiceSpec, Workload, GitSource as Source } from './generated/model'

export interface AuditEvent {
  id: string
  operation_id: string
  kind: string
  created_at: string
}

export type BuildPlan =
  | { kind: 'dockerfile'; path: string }
  | {
      kind: 'generated'
      generator: string
      runtime: string
      package_manager: string
      dockerfile: string
      dockerignore: string
    }

export interface Build {
  id: string
  service_id: string
  spec: ServiceSpec
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted'
  build_plan: BuildPlan | null
  resolved_commit: string | null
  no_cache: boolean
  cancel_requested: boolean
  error_code: string | null
  created_at: string
  logs_truncated: boolean
}
export interface Revision {
  id: string
  build_id: string
  image_repository: string
  image_digest: string
  created_at: string
}

export { api } from './api-client'

export const serviceQuery = (id: string) =>
  getGetServiceQueryOptions<Service, Error>(id, { query: { queryKey: ['services', id] } })

export type SourceKind = 'commit' | 'branch' | 'tag'
export function sourceReference(source: Source = { repository: '' }): {
  kind: SourceKind
  value: string
} {
  if (source.branch != null) return { kind: 'branch', value: source.branch }
  if (source.tag != null) return { kind: 'tag', value: source.tag }
  return { kind: 'commit', value: source.commit ?? '' }
}
export function sourceLabel(source?: Source): string {
  if (!source) return 'Managed image'
  if (source.upload) return 'Upload ' + source.upload.slice(0, 8)
  const ref = sourceReference(source)
  return ref.kind === 'commit' ? ref.value.slice(0, 8) : ref.value
}
