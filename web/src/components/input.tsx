import { cn } from 'cn'
import { cva } from 'class-variance-authority'
import { type InputHTMLAttributes, type Ref } from 'react'
import { control } from './control'

const inputVariants = cva('', {
  variants: { checkbox: { true: 'accent-orange-400', false: control } },
  defaultVariants: { checkbox: false },
})
export function Input({
  className = '',
  type,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { ref?: Ref<HTMLInputElement> }) {
  return (
    <input
      {...props}
      type={type}
      className={cn(inputVariants({ checkbox: type === 'checkbox' }), className)}
    />
  )
}
