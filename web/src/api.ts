export type Workload =
  | {
      kind: 'oci-service'
      build_mode?: 'auto' | 'dockerfile' | 'generated'
      build_command?: string
      start_command?: string
      dockerfile: string
      context: string
      replicas: number
      port: number
      readiness: { path: string; interval_seconds: number; stabilization_seconds: number }
    }
  | { kind: 'celld-service'; wrangler: string; members: number; bucket_ref: string }

export interface ServiceSpec {
  schema_version: number
  project: string
  environment: string
  name: string
  source: { repository: string; commit?: string; branch?: string; tag?: string }
  resources: { cpu_millis: number; memory_mib: number }
  distinct_nodes: boolean
  domains: string[]
  secrets: string[]
  workload: Workload
}

export interface Service {
  id: string
  operation_id: string
  version: number
  spec: ServiceSpec
  created_at: string
}
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

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, init)
  if (!response.ok) {
    const text = await response.text()
    let message = `Request failed (${response.status})`
    try {
      const error = JSON.parse(text) as {
        error?: string
        issues?: { field: string; message: string }[]
      }
      message =
        error.issues?.map((issue) => `${issue.field}: ${issue.message}`).join('\n') ||
        error.error ||
        message
    } catch {
      /* Framework rejections are plain text. Don't render submitted data. */
    }
    throw new Error(message)
  }
  return response.json() as Promise<T>
}

export const serviceQuery = (id: string) => ({
  queryKey: ['services', id],
  queryFn: () => api<Service>(`/services/${id}`),
})

export type SourceKind = 'commit' | 'branch' | 'tag'
export function sourceReference(source: ServiceSpec['source']): {
  kind: SourceKind
  value: string
} {
  if (source.branch !== undefined) return { kind: 'branch', value: source.branch }
  if (source.tag !== undefined) return { kind: 'tag', value: source.tag }
  return { kind: 'commit', value: source.commit ?? '' }
}
export function sourceLabel(source: ServiceSpec['source']): string {
  const ref = sourceReference(source)
  return ref.kind === 'commit' ? ref.value.slice(0, 8) : ref.value
}
