import { useEffect, useRef, useState } from 'react'
import { Play, KeyRound } from 'lucide-react'
import { authClient } from '../../auth-client'
import { Login } from '../../auth-shell'
import { Button } from '../../components/button'
import { Input } from '../../components/input'
import { Select } from '../../components/select'
import { Textarea } from '../../components/textarea'
import { Field } from '../../components/field'
import { CodeBlock } from './code-block'
import { copyText } from './clipboard'
import { useQuery } from '@tanstack/react-query'
import {
  boundedResponse,
  operations,
  requestPath,
  resolveSchema,
  sample,
  type Schema,
} from './api-schema'

type KeyMetadata = {
  id: string
  name: string
  prefix: string
  expiresAt: string
  revokedAt: string | null
  permissions: Record<string, string[]>
}
const scopes: Record<string, string[]> = {
  project: ['read', 'create', 'update', 'delete'],
  service: ['read', 'create', 'update', 'delete'],
  build: ['read', 'execute', 'cancel'],
  deployment: ['read', 'execute', 'stop'],
  secret: ['read', 'manage'],
  node: ['read', 'manage'],
  job: ['read', 'execute', 'manage'],
  backup: ['read', 'manage'],
  audit: ['read'],
  domain: ['read', 'manage'],
  storage: ['read', 'manage'],
  source: ['read', 'manage'],
}

async function jsonRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error || `Request failed (${response.status})`)
  return result as T
}

function SchemaFields({ schema }: { schema: Schema }) {
  const resolved = resolveSchema(schema)
  const required = new Set(resolved.required)
  return (
    <div className="my-4 overflow-x-auto rounded-lg border border-[#303037]">
      {resolved.properties ? (
        <table className="w-full text-left text-sm">
          <thead className="bg-[#17171c] text-xs text-[#a1a1aa]">
            <tr>
              <th className="p-3">Field</th>
              <th className="p-3">Type</th>
              <th className="p-3">Description</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(resolved.properties).map(([name, value]) => {
              const field = resolveSchema(value)
              return (
                <tr key={name} className="border-t border-[#29292f]">
                  <td className="p-3 font-mono text-xs">
                    {name}
                    {required.has(name) && <span className="ml-2 text-[#f0ab83]">required</span>}
                  </td>
                  <td className="p-3 font-mono text-xs text-[#a1a1aa]">
                    {field.type ?? (field.oneOf ? 'oneOf' : field.allOf ? 'object' : 'value')}
                  </td>
                  <td className="min-w-40 p-3 text-xs leading-5 text-[#a1a1aa]">
                    {field.description ??
                      (field.enum
                        ? `One of: ${field.enum.join(', ')}`
                        : (field.format ?? 'See full schema below.'))}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      ) : (
        <p className="p-4 text-sm text-[#a1a1aa]">
          {resolved.description ?? 'See the schema for accepted values.'}
        </p>
      )}
      <details className="border-t border-[#29292f] p-3 text-sm">
        <summary className="cursor-pointer">Full schema</summary>
        <CodeBlock language="json" code={JSON.stringify(resolved, null, 2)} />
      </details>
    </div>
  )
}

function usePlayground() {
  const [selected, setSelected] = useState(
    () => operations.find((op) => op.id === 'GET /api/projects')?.id ?? operations[0].id,
  )
  const endpoint = operations.find((op) => op.id === selected)!
  const [values, setValues] = useState<Record<string, string>>({})
  const [body, setBody] = useState('')
  const [mode, setMode] = useState('session')
  const [confirmed, setConfirmed] = useState(false)
  const [pending, setPending] = useState(false)
  const [response, setResponse] = useState<{ status: string; body: string } | null>(null)
  const [error, setError] = useState('')
  const keyRef = useRef<HTMLInputElement>(null)
  const controller = useRef<AbortController | null>(null)
  const requestSchema = endpoint.operation.requestBody?.content?.['application/json']?.schema
  const parameters = endpoint.operation.parameters ?? []
  const write = !['GET', 'HEAD'].includes(endpoint.method)
  useEffect(() => () => controller.current?.abort(), [])
  function changeOperation(id: string) {
    controller.current?.abort()
    setSelected(id)
    setValues({})
    setConfirmed(false)
    setResponse(null)
    setError('')
    setPending(false)
    const next = operations.find((op) => op.id === id)?.operation.requestBody?.content?.[
      'application/json'
    ]?.schema
    setBody(next ? JSON.stringify(sample(next), null, 2) : '')
  }
  async function send() {
    setError('')
    setResponse(null)
    let path: string
    try {
      path = requestPath(endpoint.path, parameters, values)
      for (const parameter of parameters) {
        if (parameter.in === 'header' && parameter.required && !values[parameter.name]?.trim())
          throw new Error(`Enter ${parameter.name}`)
      }
      if (requestSchema) JSON.parse(body)
      if (write && !confirmed)
        throw new Error('Acknowledge that this request changes real resources.')
      if (mode === 'key' && !keyRef.current?.value.trim()) throw new Error('Enter an API key.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Invalid request')
      return
    }
    const abort = new AbortController()
    controller.current?.abort()
    controller.current = abort
    setPending(true)
    const timeout = window.setTimeout(() => abort.abort(), 30000)
    try {
      const result = await fetch(path, {
        method: endpoint.method,
        credentials: mode === 'key' ? 'omit' : 'same-origin',
        cache: 'no-store',
        redirect: 'error',
        signal: abort.signal,
        headers: {
          ...Object.fromEntries(
            parameters
              .filter((p) => p.in === 'header' && values[p.name]?.trim())
              .map((p) => [p.name, values[p.name].trim()]),
          ),
          Accept: 'application/json',
          ...(requestSchema ? { 'Content-Type': 'application/json' } : {}),
          ...(mode === 'key' ? { Authorization: `Bearer ${keyRef.current!.value.trim()}` } : {}),
        },
        ...(requestSchema ? { body } : {}),
      })
      const text = await boundedResponse(result)
      if (controller.current === abort)
        setResponse({
          status: `${result.status} ${result.statusText}`,
          body: text || '(empty response)',
        })
    } catch (cause) {
      if (controller.current === abort)
        setError(
          cause instanceof Error && cause.name === 'AbortError'
            ? 'Request cancelled or timed out. A write may already have been accepted; check state before retrying.'
            : 'Request could not complete. Check your connection and platform availability.',
        )
    } finally {
      window.clearTimeout(timeout)
      setPending((current) => (controller.current === abort ? false : current))
    }
  }
  return {
    selected,
    endpoint,
    values,
    setValues,
    body,
    setBody,
    mode,
    setMode,
    confirmed,
    setConfirmed,
    pending,
    response,
    setResponse,
    error,
    keyRef,
    controller,
    requestSchema,
    parameters,
    write,
    changeOperation,
    send,
  }
}
function Playground({ signedIn }: { signedIn: boolean }) {
  const {
    selected,
    endpoint,
    values,
    setValues,
    body,
    setBody,
    mode,
    setMode,
    confirmed,
    setConfirmed,
    pending,
    response,
    setResponse,
    error,
    keyRef,
    controller,
    requestSchema,
    parameters,
    write,
    changeOperation,
    send,
  } = usePlayground()
  return (
    <section id="explorer" className="mt-12 scroll-mt-40 lg:scroll-mt-24">
      <h2 className="text-2xl font-semibold tracking-tight">Try the API</h2>
      <p className="mt-3 text-sm leading-7 text-[#a1a1aa]">
        Requests go to this platform, in your selected organization. Example bodies are editable
        templates, not valid resource IDs.
      </p>
      <div className="mt-5 grid gap-5 rounded-xl border border-[#303037] bg-[#111114] p-5">
        <Field label="Operation">
          <Select value={selected} onChange={(e) => changeOperation(e.target.value)}>
            {operations.map((op) => (
              <option key={op.id} value={op.id}>
                {op.id}
              </option>
            ))}
          </Select>
        </Field>
        <p className="text-sm text-[#b4b4be]">
          {endpoint.operation.summary ?? endpoint.operation.operationId}
        </p>
        <Field label="Authenticate with">
          <Select
            value={mode}
            onChange={(e) => {
              setMode(e.target.value)
              setResponse(null)
            }}
          >
            <option value="session">Browser session{!signedIn ? ' — sign in above' : ''}</option>
            <option value="key">API key</option>
          </Select>
        </Field>
        {mode === 'key' && (
          <Field label="API key" hint="Used for this request only. Not saved.">
            <Input ref={keyRef} type="password" autoComplete="off" spellCheck={false} />
          </Field>
        )}
        {parameters
          .filter((p) => ['path', 'query', 'header'].includes(p.in))
          .map((p) => (
            <Field
              key={`${p.in}-${p.name}`}
              label={`${p.name} (${p.in}${p.required ? ', required' : ''})`}
              hint={p.description}
            >
              <Input
                value={values[p.name] ?? ''}
                onChange={(e) => setValues({ ...values, [p.name]: e.target.value })}
                required={p.required}
              />
            </Field>
          ))}
        {requestSchema && (
          <>
            <Field label="JSON request body">
              <Textarea
                className="min-h-64 font-mono text-sm"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                spellCheck={false}
              />
            </Field>
            <SchemaFields schema={requestSchema} />
          </>
        )}
        {write && (
          <label className="flex items-start gap-3 text-sm leading-6 text-[#f0bc96]">
            <input
              aria-label="Acknowledge changes to real resources"
              className="mt-1 size-4 accent-orange-400"
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            I understand this {endpoint.method} request changes real resources.
          </label>
        )}
        <div className="flex flex-wrap gap-3">
          <Button
            variant="primary"
            disabled={pending || (write && !confirmed) || (mode === 'session' && !signedIn)}
            onClick={() => void send()}
          >
            <Play size={14} />
            {pending ? 'Sending…' : 'Send request'}
          </Button>
          {pending && <Button onClick={() => controller.current?.abort()}>Cancel</Button>}
        </div>
        {error && (
          <p role="alert" className="text-sm text-red-300">
            {error}
          </p>
        )}
      </div>
      {response && (
        <div aria-live="polite">
          <h3 className="mt-6 font-mono text-sm">Response · {response.status}</h3>
          <CodeBlock language="json" code={response.body} />
        </div>
      )}
      <details className="mt-5 rounded-lg border border-[#303037] p-4 text-sm">
        <summary className="cursor-pointer">Documented responses</summary>
        {Object.entries(endpoint.operation.responses ?? {}).map(([status, value]) => (
          <div key={status} className="mt-5">
            <h3 className="font-mono">
              {status} · {value.description}
            </h3>
            {value.content?.['application/json']?.schema && (
              <SchemaFields schema={value.content['application/json'].schema} />
            )}
          </div>
        ))}
      </details>
    </section>
  )
}

function KeyManager() {
  const organization = authClient.useActiveOrganization()
  const session = authClient.useSession()
  const [keys, setKeys] = useState<KeyMetadata[]>([])
  const [name, setName] = useState('Docs explorer')
  const [days, setDays] = useState('7')
  const [permissions, setPermissions] = useState<Record<string, string[]>>({
    project: ['read'],
    service: ['read'],
  })
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [created, setCreated] = useState(false)
  const [message, setMessage] = useState('')
  const secretRef = useRef<HTMLInputElement>(null)
  const metadata = useQuery({
    queryKey: ['personal-api-keys', session.data?.user.id, organization.data?.id],
    queryFn: ({ signal }) => jsonRequest<KeyMetadata[]>('/api/api-keys', { signal }),
    gcTime: 0,
  })
  useEffect(() => {
    if (metadata.data) setKeys(metadata.data)
  }, [metadata.data])
  async function create() {
    setPending(true)
    setError('')
    setCreated(false)
    setMessage('')
    if (secretRef.current) secretRef.current.value = ''
    try {
      const result = await jsonRequest<{ key: string; metadata: KeyMetadata }>('/api/api-keys', {
        method: 'POST',
        body: JSON.stringify({ name, expiresInDays: Number(days), permissions }),
      })
      // Keep the one-time credential out of React state and the shared query cache.
      if (secretRef.current) secretRef.current.value = result.key
      setCreated(true)
      setKeys((previous) => [result.metadata, ...previous])
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create key')
    } finally {
      setPending(false)
    }
  }
  async function revoke(id: string) {
    setPending(true)
    setError('')
    try {
      await jsonRequest(`/api/api-keys/${id}`, { method: 'DELETE' })
      setKeys((previous) =>
        previous.map((key) =>
          key.id === id ? { ...key, revokedAt: new Date().toISOString() } : key,
        ),
      )
      if (secretRef.current) secretRef.current.value = ''
      setCreated(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not revoke key')
    } finally {
      setPending(false)
    }
  }
  function toggle(resource: string, action: string) {
    const next = { ...permissions }
    const selected = next[resource] ?? []
    next[resource] = selected.includes(action)
      ? selected.filter((a) => a !== action)
      : [...selected, action]
    if (!next[resource].length) delete next[resource]
    setPermissions(next)
  }
  return (
    <section id="credentials" className="mt-12 scroll-mt-40 lg:scroll-mt-24">
      <h2 className="flex items-center gap-3 text-2xl font-semibold tracking-tight">
        <KeyRound size={22} />
        Personal API keys
      </h2>
      <p className="mt-3 text-sm leading-7 text-[#a1a1aa]">
        Keys belong to you and this organization. They cannot exceed your current role. Creating and
        revoking keys are audited actions.
      </p>
      <form
        className="mt-5 grid gap-5 rounded-xl border border-[#303037] bg-[#111114] p-5"
        onSubmit={(e) => {
          e.preventDefault()
          void create()
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Key name">
            <Input required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Expires in (days)">
            <Input
              required
              type="number"
              min={1}
              max={90}
              value={days}
              onChange={(e) => setDays(e.target.value)}
            />
          </Field>
        </div>
        <fieldset>
          <legend className="mb-3 text-sm font-medium">Permissions</legend>
          <div className="grid gap-3">
            {Object.entries(scopes).map(([resource, actions]) => (
              <div
                key={resource}
                className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-[#27272e] pb-3 text-xs"
              >
                <span className="w-24 text-sm">{resource}</span>
                {actions.map((action) => (
                  <label key={action} className="flex min-h-8 items-center gap-2 text-[#b4b4be]">
                    <input
                      aria-label={`${resource} ${action}`}
                      className="size-4 accent-orange-400"
                      type="checkbox"
                      checked={permissions[resource]?.includes(action) ?? false}
                      onChange={() => toggle(resource, action)}
                    />
                    {action}
                  </label>
                ))}
              </div>
            ))}
          </div>
        </fieldset>
        <Button
          className="w-fit"
          variant="primary"
          type="submit"
          disabled={pending || !Object.keys(permissions).length}
        >
          {pending ? 'Working…' : 'Create API key'}
        </Button>
        {(error || metadata.isError) && (
          <p role="alert" className="text-sm text-red-300">
            {error || 'Could not load keys. Check your session and organization.'}
          </p>
        )}
        <div hidden={!created} className="rounded-lg border border-[#3b5943] bg-[#142219] p-4">
          <p className="mb-3 text-sm text-[#b2d8bb]">
            Copy this key now. It will not be shown again.
          </p>
          <Field label="New API key">
            <Input ref={secretRef} type="password" readOnly autoComplete="off" />
          </Field>
          <Button
            className="mt-3"
            onClick={() =>
              void copyText(secretRef.current?.value ?? '')
                .then(() => setMessage('Key copied.'))
                .catch(() => setMessage('Copy failed. Select the key and copy manually.'))
            }
          >
            Copy key
          </Button>
          <p role="status" className="mt-2 text-xs">
            {message}
          </p>
        </div>
      </form>
      <h3 className="mt-7 text-base font-medium">Your keys</h3>
      {keys.length ? (
        <ul className="mt-3 divide-y divide-[#2c2c32]">
          {keys.map((key) => (
            <li key={key.id} className="flex flex-wrap items-center justify-between gap-3 py-4">
              <div>
                <p className="text-sm">{key.name}</p>
                <p className="mt-1 font-mono text-xs text-[#a1a1aa]">
                  {key.prefix}… ·{' '}
                  {key.revokedAt
                    ? 'Revoked'
                    : `Expires ${new Date(key.expiresAt).toLocaleDateString()}`}
                </p>
              </div>
              {!key.revokedAt && (
                <Button
                  disabled={pending}
                  onClick={() => {
                    if (
                      window.confirm(
                        `Revoke “${key.name}”? Integrations using it will stop authenticating.`,
                      )
                    )
                      void revoke(key.id)
                  }}
                >
                  Revoke
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-[#a1a1aa]">No keys loaded.</p>
      )}
    </section>
  )
}

export function ApiWorkbench({ keysOnly = false }: { keysOnly?: boolean }) {
  const session = authClient.useSession()
  const organization = authClient.useActiveOrganization()
  const organizations = authClient.useListOrganizations()
  const capabilities = useQuery({
    queryKey: ['docs-api-key-support'],
    queryFn: async ({ signal }) => {
      const schema = await jsonRequest<{ paths: Record<string, unknown> }>('/api/openapi.json', {
        signal,
      })
      return Boolean(schema.paths['/api/api-keys'])
    },
    staleTime: 60000,
  })
  const [error, setError] = useState('')
  const [switching, setSwitching] = useState(false)
  async function selectOrganization(id: string) {
    setSwitching(true)
    setError('')
    try {
      const result = await authClient.organization.setActive({ organizationId: id })
      if (result.error) setError(result.error.message ?? 'Could not change organization')
    } catch {
      setError('Could not change organization')
    } finally {
      setSwitching(false)
    }
  }
  return (
    <div className="mt-10 border-t border-[#2b2b30] pt-8">
      <h2 className="text-xl font-semibold">Your API workspace</h2>
      {session.isPending ? (
        <p className="mt-3 text-sm text-[#a1a1aa]">Checking your session…</p>
      ) : !session.data ? (
        <>
          <p className="my-4 text-sm leading-7 text-[#a1a1aa]">
            Sign in here to use your organization session or create a key. Documentation remains
            public.
          </p>
          <Login inline />
        </>
      ) : (
        <div className="my-5 grid gap-3 rounded-lg border border-[#303037] p-4">
          <p className="text-sm">Signed in as {session.data.user.name}</p>
          <Field label="Active organization">
            <Select
              disabled={switching}
              value={organization.data?.id ?? ''}
              onChange={(e) => void selectOrganization(e.target.value)}
            >
              <option value="" disabled>
                Select an organization
              </option>
              {organizations.data?.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name}
                </option>
              ))}
            </Select>
          </Field>
          {error && (
            <p role="alert" className="text-sm text-red-300">
              {error}
            </p>
          )}
        </div>
      )}
      {!switching && (
        <div key={`${session.data?.user.id ?? 'anonymous'}:${organization.data?.id ?? 'none'}`}>
          {!keysOnly && <Playground signedIn={Boolean(session.data && organization.data)} />}
          {capabilities.data && session.data && organization.data && <KeyManager />}
          {capabilities.data === false && (
            <p
              role="status"
              className="mt-8 rounded-lg border border-[#66503d] bg-[#241b14] p-5 text-sm leading-7 text-[#e2b895]"
            >
              Personal API keys are not available on this workspace's API version yet.
              Browser-session requests work above. Ask your workspace administrator to update the
              API before creating a key.
            </p>
          )}
          {capabilities.isError && (
            <p role="alert" className="mt-6 text-sm text-red-300">
              Could not check API-key availability. Check the platform connection and reload.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
