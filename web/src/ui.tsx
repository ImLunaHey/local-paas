import { cn } from 'cn'
import {
  cloneElement,
  useId,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  type ReactElement,
} from 'react'
const control =
  'block min-h-11 w-full min-w-0 rounded-md border border-[#38383c] bg-[#171719] px-3 py-2.5 text-xs text-[#e7e7eb] outline-none placeholder:text-[#85858f] focus-visible:border-orange-400 focus-visible:ring-2 focus-visible:ring-orange-400/20 disabled:cursor-not-allowed disabled:opacity-50'
export function Input({ className = '', type, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      type={type}
      className={cn(type === 'checkbox' ? 'accent-orange-400' : control, className)}
    />
  )
}
export function Select({ className = '', ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cn(control, 'pr-9', className)} />
}
export function Textarea({
  className = '',
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cn(control, 'min-h-24 resize-y', className)} />
}
export function Button({
  className = '',
  variant = 'secondary',
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' }) {
  const style =
    variant === 'primary'
      ? 'border-[#ff8a4c] bg-[#ff8a4c] text-[#1b100a] hover:bg-[#ffa36c]'
      : variant === 'ghost'
        ? 'border-transparent bg-transparent text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100'
        : 'border-[#38383c] bg-[#1b1b1e] text-zinc-200 hover:border-zinc-500 hover:bg-[#232327]'
  return (
    <button
      {...props}
      type={type}
      className={cn(
        'inline-flex min-h-11 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md border px-4 py-2.5 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-orange-400/50 disabled:cursor-not-allowed disabled:opacity-40',
        style,
        className,
      )}
    />
  )
}
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
  const generated = useId(),
    id = children.props.id ?? generated
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
        <small id={id + '-hint'} className="text-[11px] leading-relaxed text-zinc-500">
          {hint}
        </small>
      )}
    </div>
  )
}
