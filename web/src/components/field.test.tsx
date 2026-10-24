import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test } from 'vitest'
import { Field } from '../components/field'
import { Input } from '../components/input'
import { Button } from '../components/button'

test('field connects its label and description to a keyboard-operable input', async () => {
  const user = userEvent.setup()
  render(
    <form>
      <Field label="Project name" hint="Lowercase letters">
        <Input />
      </Field>
      <Button>Save</Button>
    </form>,
  )
  const input = screen.getByRole('textbox', { name: 'Project name' })
  expect(input).toHaveAccessibleDescription('Lowercase letters')
  await user.click(screen.getByText('Project name'))
  expect(input).toHaveFocus()
  await user.type(input, 'example')
  expect(input).toHaveValue('example')
  await user.tab()
  expect(screen.getByRole('button', { name: 'Save' })).toHaveFocus()
})
