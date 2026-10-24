export interface Log {
  sequence: number
  instanceId: string
  node: string
  revisionId: string
  timestamp: string
  stream: string
  line: string
  level: string
  message: string
  fields: Record<string, unknown> | null
}
export interface Marker {
  id: string
  timestamp: string
  message: string
  instanceId: string | null
}
export interface Page {
  markers?: Marker[]
  entries: Log[]
  nextCursor: number
  oldestCursor: number | null
  hasMore: boolean
  archiveWarning: string | null
}
export interface Filters {
  search: string
  level: string
  stream: string
  instanceId: string
  field: string
  value: string
  from: string
  until: string
}
