import { useState } from 'react'
import { useForm } from '@tanstack/react-form'
import { projectNameSchema } from './project-name-schema'
import { Button } from '../../components/button'
import { Field } from '../../components/field'
import { Input } from '../../components/input'
import { cn } from 'cn'

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
        <p
          role="alert"
          className="error-notice [border:1px_solid_#4d2b2d] [background:light-dark(#f4f4f5,_#231719)] [border-radius:7px] [padding:18px] [font-size:12px] [color:#ffb4ae] [line-height:1.8] [overflow-wrap:anywhere] [&_p]:[margin-top:5px]"
        >
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
