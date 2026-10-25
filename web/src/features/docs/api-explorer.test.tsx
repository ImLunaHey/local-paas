import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, expect, test, vi } from 'vitest'
import { ApiWorkbench } from './api-explorer'

vi.mock('../../auth-client', () => ({
  authClient: {
    useSession: () => ({
      data: { user: { id: 'test-user', name: 'Test user' } },
      isPending: false,
    }),
    useActiveOrganization: () => ({ data: { id: 'test-org' }, isPending: false }),
    useListOrganizations: () => ({ data: [{ id: 'test-org', name: 'Test workspace' }] }),
  },
}))
vi.mock('../../auth-shell', () => ({ Login: () => null }))

afterEach(() => vi.restoreAllMocks())

function fixture() {
  const calls: { url: string; init?: RequestInit }[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    calls.push({ url, init })
    if (url === '/api/openapi.json') return Response.json({ paths: { '/api/api-keys': {} } })
    if (url === '/api/api-keys' && init?.method === 'POST')
      return Response.json({
        key: 'lp_test_display_only',
        metadata: {
          id: 'test-key',
          name: 'Docs explorer',
          prefix: 'lp_test',
          expiresAt: '2030-01-01',
          revokedAt: null,
          permissions: { project: ['read'] },
        },
      })
    if (url === '/api/api-keys') return Response.json([])
    if (url === '/api/api-keys/test-key') return Response.json({ revoked: true })
    return Response.json({ items: [] })
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <ApiWorkbench />
    </QueryClientProvider>,
  )
  return { calls, client }
}

test('explorer sends only explicit requests and confirms writes', async () => {
  const { calls } = fixture()
  const user = userEvent.setup()
  await screen.findByRole('button', { name: 'Create API key' })
  expect(calls.every((call) => !call.init?.method)).toBe(true)
  await user.click(screen.getByRole('button', { name: 'Send request' }))
  await screen.findByText(/Response · 200/)
  expect(calls.find((call) => call.url === '/api/projects')?.init).toMatchObject({
    method: 'GET',
    credentials: 'same-origin',
    cache: 'no-store',
    redirect: 'error',
  })
  await user.selectOptions(screen.getByLabelText('Operation'), 'POST /api/projects')
  expect(screen.getByRole('button', { name: 'Send request' })).toBeDisabled()
  await user.click(screen.getByRole('checkbox', { name: 'Acknowledge changes to real resources' }))
  expect(screen.getByRole('button', { name: 'Send request' })).toBeEnabled()
  expect(calls.some((call) => call.url === '/api/projects' && call.init?.method === 'POST')).toBe(
    false,
  )
})

test('one-time key never enters storage or query caches and can be revoked', async () => {
  const { calls, client } = fixture()
  const user = userEvent.setup()
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  const store = vi.spyOn(Storage.prototype, 'setItem')
  await user.click(await screen.findByRole('button', { name: 'Create API key' }))
  const key = await screen.findByLabelText('New API key')
  await waitFor(() => expect(key).toHaveValue('lp_test_display_only'))
  expect(key).toHaveAttribute('type', 'password')
  expect(store).not.toHaveBeenCalled()
  expect(
    JSON.stringify(
      client
        .getQueryCache()
        .getAll()
        .map((query) => query.state.data),
    ),
  ).not.toContain('lp_test_display_only')
  expect(client.getMutationCache().getAll()).toHaveLength(0)
  expect(
    JSON.parse(calls.find((call) => call.init?.method === 'POST')!.init!.body as string),
  ).toMatchObject({ expiresInDays: 7, permissions: { project: ['read'], service: ['read'] } })
  await user.click(screen.getByRole('button', { name: 'Revoke' }))
  await waitFor(() =>
    expect(
      calls.some((call) => call.url === '/api/api-keys/test-key' && call.init?.method === 'DELETE'),
    ).toBe(true),
  )
  await waitFor(() => expect(key).toHaveValue(''))
})
