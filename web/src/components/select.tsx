import { cn } from 'cn'
import { type SelectHTMLAttributes } from 'react'
import { control } from './control'
export function Select({ className = '', ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cn(control, 'pr-9', className)} />
}
