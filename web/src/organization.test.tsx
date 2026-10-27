import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { authClient } from './auth-client'
import { OrganizationSettings } from './organization'

vi.mock('./auth-client', async (importOriginal) => {
  const original = await importOriginal<typeof import('./auth-client')>()
  return {
    ...original,
    authClient: {
      useActiveOrganization: () => ({ data: { id: 'test-org', name: 'Test', members: [] } }),
      organization: {
        listRoles: vi.fn().mockResolvedValue({ data: [] }),
        listTeams: vi.fn().mockResolvedValue({ data: [] }),
        createRole: vi.fn().mockResolvedValue({ data: {} }),
      },
    },
  }
})

test.each(['read', 'manage'] as const)('creates a role granting only source:%s', async (action) => {
  const user = userEvent.setup()
  render(<OrganizationSettings />)
  await user.type(screen.getByRole('textbox', { name: 'Role name' }), `source-${action}`)
  // Exercise deselection too: the submitted role must not retain the other action.
  const other = action === 'read' ? 'manage' : 'read'
  await user.click(screen.getByRole('checkbox', { name: `source ${other}` }))
  await user.click(screen.getByRole('checkbox', { name: `source ${action}` }))
  await user.click(screen.getByRole('checkbox', { name: `source ${other}` }))
  await user.click(screen.getByRole('button', { name: 'Create role' }))
  await waitFor(() =>
    expect(authClient.organization.createRole).toHaveBeenLastCalledWith({
      role: `source-${action}`,
      permission: { source: [action] },
    }),
  )
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Role name' })).toHaveValue(''))
  expect(screen.getByRole('checkbox', { name: 'source read' })).not.toBeChecked()
  expect(screen.getByRole('checkbox', { name: 'source manage' })).not.toBeChecked()
})
