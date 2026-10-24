import type { Service, ServiceSpec, GitSource as Source } from './generated/model'
import { getGetServiceQueryOptions } from './generated/management'
export type { Service, ServiceSpec, Workload, GitSource as Source } from './generated/model'

export type { Event as AuditEvent } from './generated/model'

export type BuildPlan =
  | { kind: 'dockerfile'; path: string }
  | {
      kind: 'generated'
      generator: string
      runtime: string
      packageManager: string
      dockerfile: string
      dockerignore: string
    }

export interface Build {
  id: string
  serviceId: string
  spec: ServiceSpec
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted'
  buildPlan: BuildPlan | null
  resolvedCommit: string | null
  noCache: boolean
  cancelRequested: boolean
  errorCode: string | null
  createdAt: string
  logsTruncated: boolean
}
export interface Revision {
  id: string
  buildId: string
  imageRepository: string
  imageDigest: string
  createdAt: string
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
