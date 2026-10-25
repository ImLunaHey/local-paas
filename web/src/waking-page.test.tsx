import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { WakingPageSettings } from './waking-page'
vi.mock('./components/html-editor', () => ({
  HtmlEditor: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
    <textarea
      aria-label="Waking page HTML"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}))

const template =
  '<!doctype html><html><body><h1>{{service_name}}</h1>{{readiness_script}}</body></html>'
const editedTemplate = template.replace('<h1>', '<h1>Custom ')
function file(html: string) {
  const upload = new File([html], 'custom.html', { type: 'text/html' })
  Object.defineProperty(upload, 'arrayBuffer', {
    value: async () => new TextEncoder().encode(html).buffer,
  })
  return upload
}
function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <WakingPageSettings serviceId="service" />
    </QueryClientProvider>,
  )
}
afterEach(() => vi.unstubAllGlobals())

it('previews edits without writing them and can discard the draft', async () => {
  const fetch = vi.fn(async () =>
    Response.json({ version: 0, html: null, starterTemplate: template }),
  )
  vi.stubGlobal('fetch', fetch)
  mount()
  const user = userEvent.setup()
  const editor = await screen.findByRole('textbox', { name: 'Waking page HTML' })
  await user.clear(editor)
  await user.click(editor)
  await user.paste(editedTemplate)
  expect(screen.getByText('Unsaved changes')).toBeInTheDocument()
  await waitFor(() =>
    expect(screen.getByTitle('Waking page preview').getAttribute('srcdoc')).toContain(
      'Custom Your service',
    ),
  )
  expect(fetch).toHaveBeenCalledTimes(1)
  await user.click(screen.getByRole('button', { name: 'Discard edits' }))
  expect(editor).toHaveValue(template)
  expect(screen.getByRole('button', { name: 'Save waking page' })).toBeDisabled()
})

it('uploads HTML with the current version and restores the default without executing the upload', async () => {
  let state = { version: 0, html: null as string | null, starterTemplate: template }
  const requests: { html: string | null; expectedVersion: number; operationId: string }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        const input = JSON.parse(String(init.body))
        requests.push(input)
        state = { ...state, version: state.version + 1, html: input.html }
      }
      return Response.json(state)
    }),
  )
  mount()
  const user = userEvent.setup()
  await user.upload(await screen.findByLabelText('Import HTML file'), file(editedTemplate))
  await user.click(screen.getByRole('button', { name: 'Save waking page' }))
  expect(await screen.findByText('Custom HTML page saved.')).toBeInTheDocument()
  expect(requests[0]).toMatchObject({
    html: editedTemplate,
    expectedVersion: 0,
    operationId: expect.any(String),
  })
  expect(screen.getByTitle('Waking page preview')).toHaveAttribute('sandbox', '')
  expect(screen.getByTitle('Waking page preview')).toHaveAttribute('inert')
  expect(screen.queryByRole('heading', { name: '{{service_name}}' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Restore default page' }))
  expect(await screen.findByText('Using the dashboard-themed default page.')).toBeInTheDocument()
  expect(requests[1]).toMatchObject({ html: null, expectedVersion: 1 })
})

it('rejects oversized files and missing readiness injection before sending a write', async () => {
  const fetch = vi.fn(async () =>
    Response.json({ version: 0, html: null, starterTemplate: template }),
  )
  vi.stubGlobal('fetch', fetch)
  mount()
  const user = userEvent.setup()
  const input = await screen.findByLabelText('Import HTML file')
  await user.upload(input, file('x'.repeat(128 * 1024 + 1)))
  expect(await screen.findByRole('alert')).toHaveTextContent('128 KiB')
  await user.upload(input, file('<h1>No runtime</h1>'))
  await user.click(screen.getByRole('button', { name: 'Save waking page' }))
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent('Include {{readiness_script}}'),
  )
  expect(fetch).toHaveBeenCalledTimes(1)
})

it('shows a version conflict without claiming the custom page was saved', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === 'PUT'
        ? Response.json({ error: 'waking page changed; reload before saving' }, { status: 409 })
        : Response.json({ version: 2, html: null, starterTemplate: template }),
    ),
  )
  mount()
  const user = userEvent.setup()
  await user.upload(await screen.findByLabelText('Import HTML file'), file(editedTemplate))
  await user.click(screen.getByRole('button', { name: 'Save waking page' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('waking page changed')
  expect(screen.queryByText('Custom HTML page saved.')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Save waking page' })).toBeEnabled()
})
