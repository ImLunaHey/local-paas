import document from '../../../../docs/api/openapi.json'

export type Schema = {
  $ref?: string
  type?: string | string[]
  description?: string
  properties?: Record<string, Schema>
  required?: string[]
  items?: Schema
  enum?: unknown[]
  default?: unknown
  example?: unknown
  oneOf?: Schema[]
  allOf?: Schema[]
  anyOf?: Schema[]
  format?: string
  minimum?: number
}
export type Parameter = {
  name: string
  in: string
  required?: boolean
  description?: string
  schema?: Schema
}
export type Operation = {
  operationId?: string
  summary?: string
  description?: string
  parameters?: Parameter[]
  requestBody?: { content?: Record<string, { schema?: Schema }> }
  responses?: Record<
    string,
    { description?: string; content?: Record<string, { schema?: Schema }> }
  >
}
const schema = document as unknown as {
  paths: Record<string, Record<string, Operation>>
  components: { schemas: Record<string, Schema> }
}
export function resolveSchema(value: Schema): Schema {
  return value.$ref
    ? (schema.components.schemas[value.$ref.split('/').at(-1) ?? ''] ?? value)
    : value
}
export function sample(value: Schema, depth = 0): unknown {
  if (depth > 6) return null
  const s = resolveSchema(value)
  if (s.example !== undefined) return s.example
  if (s.default !== undefined) return s.default
  if (s.enum) return s.enum.find((v) => v !== null)
  if (s.oneOf || s.anyOf) return sample((s.oneOf ?? s.anyOf)![0], depth + 1)
  if (s.allOf) return Object.assign({}, ...s.allOf.map((v) => sample(v, depth + 1)))
  const required = new Set(s.required)
  if (s.properties)
    return Object.fromEntries(
      Object.entries(s.properties)
        .filter(([name]) => required.has(name))
        .map(([name, child]) => [name, sample(child, depth + 1)]),
    )
  if (s.type === 'array') return []
  if (s.type === 'boolean') return false
  if (s.type === 'integer' || s.type === 'number') return s.minimum ?? 0
  if (s.format === 'uuid') return ''
  return ''
}
export const operations = Object.entries(schema.paths)
  .flatMap(([path, methods]) =>
    Object.entries(methods)
      .filter(([method]) => ['get', 'post', 'put', 'patch', 'delete'].includes(method))
      .map(([method, operation]) => ({
        path,
        method: method.toUpperCase(),
        operation,
        id: `${method.toUpperCase()} ${path}`,
      })),
  )
  .filter((op) => !op.path.startsWith('/api/api-keys'))

export function requestPath(
  template: string,
  parameters: Parameter[],
  values: Record<string, string>,
) {
  if (!operations.some((op) => op.path === template)) throw new Error('Unknown API operation')
  let path = template.replace(/\{([^}]+)\}/g, (_, key: string) => {
    const value = values[key]?.trim()
    if (!value || !/^[a-zA-Z0-9_.-]+$/.test(value) || value === '.' || value === '..')
      throw new Error(`Enter a valid ${key}; path separators are not allowed`)
    return encodeURIComponent(value)
  })
  const query = new URLSearchParams()
  parameters
    .filter((p) => p.in === 'query')
    .forEach((p) => {
      const value = values[p.name]?.trim()
      if (!value && p.required) throw new Error(`Enter ${p.name}`)
      if (value) query.set(p.name, value)
    })
  if (query.size) path += `?${query}`
  return path
}

export async function boundedResponse(response: Response) {
  if (!response.body) return ''
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let output = ''
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > 262144) {
        await reader.cancel()
        return output + '\n[Response truncated at 256 KiB]'
      }
      output += decoder.decode(value, { stream: true })
    }
    output += decoder.decode()
    try {
      return JSON.stringify(JSON.parse(output), null, 2)
    } catch {
      return output
    }
  } finally {
    reader.releaseLock()
  }
}
