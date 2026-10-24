import { cn } from 'cn'
import { type InputHTMLAttributes, type Ref } from 'react'
import { control } from './control'
export function Input({
  className = '',
  type,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { ref?: Ref<HTMLInputElement> }) {
  return (
    <input
      {...props}
      type={type}
      className={cn(type === 'checkbox' ? 'accent-orange-400' : control, className)}
    />
  )
}
