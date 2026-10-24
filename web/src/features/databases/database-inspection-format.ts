import type { Field } from './database-inspection-types'

export function number(value: unknown) {
  return typeof value === 'number' ? value.toLocaleString() : '—'
}
export function bytes(value: unknown) {
  if (typeof value !== 'number') return '—'
  if (value < 1024) return `${value} B`
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KiB`
  return `${(value / 1024 ** 2).toFixed(1)} MiB`
}
export function ratio(hits: unknown, misses: unknown) {
  return typeof hits === 'number' && typeof misses === 'number' && hits + misses > 0
    ? `${((100 * hits) / (hits + misses)).toFixed(1)}%`
    : '—'
}

export const columnFields: Field[] = [
  { key: 'name', label: 'Column' },
  { key: 'type', label: 'Type' },
  { key: 'nullable', label: 'Nullable' },
  { key: 'primaryKey', label: 'Primary key' },
  { key: 'identity', label: 'Identity' },
  { key: 'generated', label: 'Generated' },
]
export const indexFields: Field[] = [
  { key: 'name', label: 'Index' },
  { key: 'method', label: 'Method' },
  { key: 'unique', label: 'Unique' },
  { key: 'primaryKey', label: 'Primary key' },
  { key: 'valid', label: 'Valid' },
  { key: 'sizeBytes', label: 'Size', format: bytes },
]
export const tableFields: Field[] = [
  { key: 'name', label: 'Table' },
  { key: 'schema', label: 'Schema' },
  { key: 'kind', label: 'Kind' },
  { key: 'estimatedRows', label: 'Estimated rows', format: number },
  { key: 'tableBytes', label: 'Table size', format: bytes },
  { key: 'indexBytes', label: 'Index size', format: bytes },
]
export const keyspaceFields: Field[] = [
  { key: 'name', label: 'Keyspace' },
  { key: 'keys', label: 'Keys', format: number },
  { key: 'expires', label: 'Keys with expiry', format: number },
  { key: 'avgTtlMs', label: 'Average TTL (ms)', format: number },
]
