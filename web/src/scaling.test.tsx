import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { ScalingPanel } from './scaling'
import type { Service } from './generated/model/service'
vi.mock('./waking-page', () => ({ WakingPageSettings: () => null }))

const service = { id: 'test-service', spec: { name: 'test-service' } } as Service
const status = {
  eligible: true,
  currentReplicas: 0,
  state: {
    version: 3,
    desiredReplicas: 0,
    condition: 'metrics_unavailable',
    policy: {
      enabled: true,
      minReplicas: 0,
      maxReplicas: 3,
      targetCpuPercent: 70,
      maxStep: 1,
      scaleUpWindowSeconds: 30,
      scaleDownWindowSeconds: 300,
      cooldownSeconds: 60,
      idleSeconds: 600,
      nodeNames: [],
      failureDomains: [],
      preferFailureDomainSpread: true,
    },
  },
  decisions: [
    {
      id: 'decision',
      timestamp: '2026-10-25T10:00:00Z',
      currentReplicas: 0,
      recommendedReplicas: 0,
      desiredReplicas: 0,
      cpuPercent: null,
      reason: 'metrics_unavailable',
      estimatedCapacity: 2,
    },
  ],
  limits: { enabled: true, maxInstances: 64, maxCpuMillis: 16000, maxMemoryMib: 32768 },
}
function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <ScalingPanel service={service} />
    </QueryClientProvider>,
  )
}
afterEach(() => vi.unstubAllGlobals())
it('shows unavailable metrics and submits edits with the policy version', async () => {
  const requests: RequestInit[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') requests.push(init)
      return Response.json(status)
    }),
  )
  mount()
  expect(await screen.findByText('CPU unavailable')).toBeInTheDocument()
  const user = userEvent.setup()
  const maximum = screen.getByLabelText('Maximum replicas')
  await user.clear(maximum)
  await user.type(maximum, '4')
  await user.click(screen.getByRole('button', { name: 'Save scaling policy' }))
  await waitFor(() => expect(requests).toHaveLength(1))
  const body = JSON.parse(String(requests[0]?.body))
  expect(body.expectedVersion).toBe(3)
  expect(body.policy.maxReplicas).toBe(4)
  expect(body.policy.minReplicas).toBe(0)
  expect(body.operationId).toEqual(expect.any(String))
})
it('explains ineligibility without presenting an enable control', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ ...status, eligible: false })),
  )
  mount()
  expect(await screen.findByText(/Only stateless HTTP OCI services/)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Save scaling policy' })).not.toBeInTheDocument()
})
it('keeps a rejected policy editable and displays the server reason', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === 'PUT'
        ? Response.json({ error: 'scaling policy changed; reload before saving' }, { status: 409 })
        : Response.json(status),
    ),
  )
  mount()
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: 'Save scaling policy' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('scaling policy changed')
  expect(screen.getByRole('button', { name: 'Save scaling policy' })).toBeEnabled()
})
