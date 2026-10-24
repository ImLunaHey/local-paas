import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ProjectNameForm } from './project-name-form'

describe('ProjectNameForm', () => {
  it('validates names before submitting and resets dirty state after saving', async () => {
    const user = userEvent.setup()
    const save = vi.fn().mockResolvedValue(undefined)
    render(<ProjectNameForm label="Create project" onSave={save} />)
    const input = screen.getByRole('textbox', { name: 'Project name' })
    const submit = screen.getByRole('button', { name: 'Create project' })
    expect(submit).toBeDisabled()
    await user.type(input, 'Invalid name')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(submit).toBeDisabled()
    expect(save).not.toHaveBeenCalled()
    await user.clear(input)
    await user.type(input, 'my-project')
    await user.click(submit)
    await waitFor(() => expect(save).toHaveBeenCalledExactlyOnceWith('my-project'))
    await waitFor(() => expect(submit).toBeDisabled())
    expect(input).toHaveValue('my-project')
  })

  it('keeps a failed rename editable and retries the same name', async () => {
    const user = userEvent.setup()
    const save = vi
      .fn()
      .mockRejectedValueOnce(new Error('Project changed; reload settings.'))
      .mockResolvedValue(undefined)
    render(<ProjectNameForm initialName="old-name" label="Save changes" onSave={save} />)
    const input = screen.getByRole('textbox', { name: 'Project name' })
    const submit = screen.getByRole('button', { name: 'Save changes' })
    await user.clear(input)
    await user.type(input, 'new-name')
    await user.click(submit)
    expect(await screen.findByRole('alert')).toHaveTextContent('Project changed; reload settings.')
    expect(input).toHaveValue('new-name')
    await user.click(submit)
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2))
    expect(save).toHaveBeenLastCalledWith('new-name')
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  })
})
