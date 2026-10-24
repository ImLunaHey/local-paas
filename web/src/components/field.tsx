import { cn } from 'cn'
import { cloneElement, useId, type ReactElement } from 'react'
export function Field({
  label,
  hint,
  className = '',
  children,
}: {
  label: string
  hint?: string
  className?: string
  children: ReactElement<{ id?: string; 'aria-describedby'?: string }>
}) {
  const generatedId = useId()
  const id = children.props.id ?? generatedId
  return (
    <div className={cn('flex min-w-0 flex-col gap-2', className)}>
      <label htmlFor={id} className="text-xs leading-4 text-zinc-300">
        {label}
      </label>
      {cloneElement(children, {
        id,
        'aria-describedby': hint ? id + '-hint' : children.props['aria-describedby'],
      })}
      {hint && (
        <small id={id + '-hint'} className="text-[11px] leading-relaxed text-zinc-400">
          {hint}
        </small>
      )}
    </div>
  )
}
