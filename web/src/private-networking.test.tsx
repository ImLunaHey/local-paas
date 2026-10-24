import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { PrivateNetworking } from './private-networking'
import type { Service } from './generated/model/service'

vi.mock('./api-client', () => ({ api: vi.fn(async () => ({ items: [] })) }))

test('removing a connection preserves the remaining row input identity and draft', async () => {
  const user = userEvent.setup()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const service = {
    id: 'service',
    version: 1,
    spec: {
      project: 'example',
      environment: 'development',
      workload: {
        kind: 'oci-service',
        privateConnections: [
          { serviceId: '', env: 'FIRST_URL' },
          { serviceId: '', env: 'SECOND_URL' },
        ],
      },
    },
  } as Service
  render(
    <QueryClientProvider client={client}>
      <PrivateNetworking service={service} />
    </QueryClientProvider>,
  )
  const remainingInput = screen.getByRole('textbox', { name: 'URL variable 2' })
  await user.clear(remainingInput)
  await user.type(remainingInput, 'EDITED_URL')
  await user.click(screen.getByRole('button', { name: 'Remove connection 1' }))
  expect(screen.getByRole('textbox', { name: 'URL variable 1' })).toBe(remainingInput)
  expect(remainingInput).toHaveValue('EDITED_URL')
  expect(screen.queryByRole('textbox', { name: 'URL variable 2' })).not.toBeInTheDocument()
  client.clear()
})
