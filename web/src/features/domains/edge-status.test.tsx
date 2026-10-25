import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { EdgeStatus } from './edge-status'
import type { DomainObservation } from '../../generated/model/domainObservation'

const domain: DomainObservation = {
  hostname: 'app.example.test',
  version: 1,
  createdAt: '2026-10-25T12:00:00Z',
  updatedAt: '2026-10-25T12:00:00Z',
  generation: 3,
  acknowledgedGeneration: 2,
  ownershipRecord: { name: '_local-paas.app.example.test', value: 'local-paas=test-challenge' },
  status: 'ownership_pending',
  errorCode: 'ownership_pending',
}

describe('observed edge state', () => {
  it('shows the DNS action and missing observations without claiming a certificate exists', () => {
    render(<EdgeStatus domain={domain} />)
    expect(screen.getByRole('status')).toHaveTextContent('Add the TXT record')
    expect(screen.getByText('_local-paas.app.example.test')).toBeVisible()
    expect(screen.getByText('local-paas=test-challenge')).toBeVisible()
    expect(screen.getByText('2 / 3')).toBeVisible()
    expect(screen.getAllByText('Not observed')).toHaveLength(2)
  })

  it('reports an expired acknowledgement even when a certificate was previously observed', () => {
    render(
      <EdgeStatus
        domain={{
          ...domain,
          status: 'lease-expired',
          errorCode: null,
          certificateExpiresAt: '2026-11-25T12:00:00Z',
          leaseExpiresAt: '2026-10-25T12:01:00Z',
        }}
      />,
    )
    expect(screen.getByText(/Public availability is no longer confirmed/)).toBeVisible()
    expect(screen.queryByText(/were verified through the edge/)).not.toBeInTheDocument()
  })
})
