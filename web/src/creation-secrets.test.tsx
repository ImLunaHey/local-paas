import { createRef } from 'react'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test } from 'vitest'
import { CreationSecrets, type CreationSecretsHandle } from './creation-secrets'

test('acknowledged secrets are cleared and omitted from retries while unsaved values survive', async () => {
  const user = userEvent.setup()
  const ref = createRef<CreationSecretsHandle>()
  render(<CreationSecrets ref={ref} locked={false} />)
  for (const [index, name] of ['FIRST', 'SECOND'].entries()) {
    await user.click(screen.getByRole('button', { name: 'Add secret' }))
    await user.type(screen.getByLabelText(`Secret name ${index + 1}`), name)
    await user.type(screen.getByLabelText(`Secret value ${index + 1}`), 'test-only-value')
  }
  const entries = ref.current!.read()
  act(() => ref.current!.saved(entries[0].id))
  expect(screen.getByLabelText('Secret value 1')).toHaveValue('')
  expect(screen.getByLabelText('Secret value 1')).toBeDisabled()
  expect(ref.current!.read().map((entry) => entry.name)).toEqual(['SECOND'])
})

test('duplicate names are rejected before sending any value', async () => {
  const user = userEvent.setup()
  const ref = createRef<CreationSecretsHandle>()
  render(<CreationSecrets ref={ref} locked={false} />)
  for (const index of [1, 2]) {
    await user.click(screen.getByRole('button', { name: 'Add secret' }))
    await user.type(screen.getByLabelText(`Secret name ${index}`), 'DUPLICATE')
    await user.type(screen.getByLabelText(`Secret value ${index}`), 'test-only-value')
  }
  expect(() => ref.current!.read()).toThrow('unique environment variable name')
})
