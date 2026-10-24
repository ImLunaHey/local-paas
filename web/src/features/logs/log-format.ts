import type { Log } from './log-types'

export function logMessage(log: Log): string | null {
  if (!log.fields) return log.message || log.line || ' '
  if (typeof log.fields.msg === 'string') return log.fields.msg
  if (typeof log.fields.message === 'string') return log.fields.message
  return null
}
export function flatFields(
  object: Record<string, unknown>,
  prefix = '',
  depth = 0,
): [string, string][] {
  return Object.entries(object).flatMap(([key, value]) => {
    const path = prefix ? prefix + '.' + key : key
    if (value && typeof value === 'object' && !Array.isArray(value) && depth < 5)
      return flatFields(value as Record<string, unknown>, path, depth + 1)
    return value !== null && typeof value !== 'object' && /^[A-Za-z0-9_.]+$/.test(path)
      ? [[path, String(value)]]
      : []
  })
}
