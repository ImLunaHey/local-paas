export type Row = Record<string, string | number | boolean | null>
export interface Snapshot {
  engine: 'postgres' | 'redis'
  observedAt: string
  stats: Row
  tables?: Row[]
  tablesTruncated?: boolean
  table?: {
    schema: string
    name: string
    columns: Row[]
    indexes: Row[]
    indexesTruncated: boolean
  } | null
  keyspaces?: Row[]
}
export type Field = { key: string; label: string; format?: (value: unknown) => string }
