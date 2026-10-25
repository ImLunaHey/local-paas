import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import { Script } from 'node:vm'
import { docs, searchDocs, sections } from './content'
import { CodeBlock } from './code-block'
import { copyText } from './clipboard'
import { operations, requestPath, sample, boundedResponse } from './api-schema'
import { ServiceExample, DeploymentExample } from './examples'

afterEach(() => vi.restoreAllMocks())

test('every customer guide has substantial content, unique headings, and valid page links', () => {
  const slugs = new Set(docs.map((doc) => doc.slug))
  expect(slugs.size).toBe(docs.length)
  expect(docs.length).toBeGreaterThanOrEqual(22)
  for (const doc of docs) {
    expect(doc.body.split(/\s+/).length, doc.slug).toBeGreaterThan(200)
    const headings = sections(doc)
    expect(new Set(headings.map((h) => h.id)).size, doc.slug).toBe(headings.length)
    for (const link of doc.body.matchAll(/\]\(\/docs\/?([^)]*)\)/g))
      expect(slugs.has(link[1]), `${doc.slug}: ${link[1]}`).toBe(true)
    for (const related of doc.related ?? []) expect(slugs.has(related)).toBe(true)
  }
  for (const operator of ['installation', 'architecture', 'nodes', 'upgrades', 'backups'])
    expect(slugs.has(operator)).toBe(false)
})

test('search indexes article contents as well as titles', () => {
  expect(searchDocs('DATABASE_URL').some((doc) => doc.slug === 'variables')).toBe(true)
  expect(searchDocs('0.0.0.0').some((doc) => doc.slug === 'nodejs')).toBe(true)
  expect(searchDocs('')).toEqual([])
  expect(searchDocs('not-a-real-topic')).toEqual([])
})

test('the complete Node.js example has valid JSON and JavaScript', () => {
  const body = docs.find((doc) => doc.slug === 'nodejs')!.body
  const manifest = body.match(/~~~json package.json\n([\s\S]+?)\n~~~/)![1]
  expect(JSON.parse(manifest).scripts.start).toBe('node server.js')
  const source = body.match(/~~~javascript server.js\n([\s\S]+?)\n~~~/)![1]
  expect(() => new Script(source.replace(/^import .+\n/gm, ''))).not.toThrow()
})

test.each(['json', 'javascript', 'bash', 'dockerfile', 'toml', 'python', 'go', 'rust'])(
  'code blocks support %s without inline styles or grammar errors',
  (language) => {
    const { container } = render(<CodeBlock language={language} code={'hello = "world"'} />)
    expect(screen.getByText(language)).toBeInTheDocument()
    expect(container.querySelector('[style]')).toBeNull()
    expect(screen.getByRole('button', { name: `Copy ${language} code` })).toBeEnabled()
  },
)

test('HTTP clipboard fallback restores focus and removes temporary secret text', async () => {
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value: false })
  const copy = vi.fn(() => true)
  Object.defineProperty(document, 'execCommand', { configurable: true, value: copy })
  const { container } = render(<button type="button">Original focus</button>)
  const button = screen.getByRole('button')
  button.focus()
  await copyText('example copy value')
  expect(copy).toHaveBeenCalledWith('copy')
  expect(document.querySelector('textarea')).toBeNull()
  expect(button).toHaveFocus()
  expect(container.textContent).not.toContain('example copy value')
})

test('API URLs come from the contract and cannot escape through path fields', () => {
  expect(operations.some((op) => op.id === 'GET /api/services/{id}/events')).toBe(true)
  expect(operations.some((op) => op.id === 'PUT /api/services/{id}/scaling')).toBe(true)
  expect(operations.some((op) => op.path.startsWith('/api/api-keys'))).toBe(false)
  expect(requestPath('/api/projects/{id}', [], { id: 'abc-123' })).toBe('/api/projects/abc-123')
  expect(requestPath('/api/domains/{hostname}', [], { hostname: 'api.example.com' })).toBe(
    '/api/domains/api.example.com',
  )
  for (const id of ['../auth', '%2Fauth', 'a/b', 'a?x=1', ''])
    expect(() => requestPath('/api/projects/{id}', [], { id })).toThrow()
  expect(() => requestPath('https://example.com', [], {})).toThrow()
  expect(
    sample({
      type: 'object',
      required: ['name'],
      properties: { name: { type: 'string' }, optional: { type: 'boolean' } },
    }),
  ).toEqual({ name: '' })
})

test('responses are bounded and rendered as text, not executable markup', async () => {
  expect(await boundedResponse(new Response('{"ok":true}'))).toBe('{\n  "ok": true\n}')
  expect(await boundedResponse(new Response('x'.repeat(300000)))).toContain('truncated')
})

test('examples use editable controls and never send requests', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch')
  const user = userEvent.setup()
  render(
    <>
      <ServiceExample />
      <DeploymentExample />
    </>,
  )
  await user.clear(screen.getByLabelText('Container port'))
  await user.type(screen.getByLabelText('Container port'), '8080')
  expect(screen.getByText('Probe → HTTP :8080/health')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Replay' }))
  expect(screen.getByText('In progress')).toBeInTheDocument()
  expect(fetch).not.toHaveBeenCalled()
})
