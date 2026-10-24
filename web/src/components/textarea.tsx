import { cn } from 'cn'
import { type TextareaHTMLAttributes } from 'react'
import { control } from './control'
export function Textarea({
  className = '',
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cn(control, 'min-h-24 resize-y', className)} />
}
