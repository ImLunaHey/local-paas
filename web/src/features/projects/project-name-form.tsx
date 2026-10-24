import { useState } from 'react'
import { useForm } from '@tanstack/react-form'
import { z } from 'zod'
import { Button, Field, Input } from '../../ui'
import { cn } from 'cn'

export const projectNameSchema = z.object({
  name: z
    .string()
    .min(1, 'Enter a project name.')
    .max(63)
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and single hyphens.'),
})

export function ProjectNameForm({
  initialName = '',
  label,
  onSave,
  className,
}: {
  initialName?: string
  label: string
  onSave: (name: string) => Promise<unknown>
  className?: string
}) {
  const [error, setError] = useState<string>()
  const form = useForm({
    defaultValues: { name: initialName },
    validators: { onChange: projectNameSchema },
    onSubmit: async ({ value, formApi }) => {
      setError(undefined)
      try {
        await onSave(value.name)
        formApi.reset(value)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Could not save project.')
      }
    },
  })
  return (
    <form
      className={cn('space-y-4', className)}
      onSubmit={(event) => {
        event.preventDefault()
        void form.handleSubmit()
      }}
    >
      <form.Field name="name">
        {(field) => (
          <>
            <Field label="Project name" hint="Use lowercase letters, numbers and hyphens.">
              <Input
                name={field.name}
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
                required
                maxLength={63}
                aria-invalid={!field.state.meta.isValid}
                aria-errormessage={field.state.meta.isValid ? undefined : 'project-name-error'}
              />
            </Field>
            {!field.state.meta.isValid && (
              <p id="project-name-error" role="alert" className="text-sm text-red-300">
                {field.state.meta.errors.map((issue) => issue?.message).join(' ')}
              </p>
            )}
          </>
        )}
      </form.Field>
      {error && (
        <p role="alert" className="error-notice">
          {error}
        </p>
      )}
      <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting, state.isDirty]}>
        {([canSubmit, submitting, dirty]) => (
          <Button variant="primary" type="submit" disabled={!canSubmit || submitting || !dirty}>
            {submitting ? 'Saving…' : label}
          </Button>
        )}
      </form.Subscribe>
    </form>
  )
}
