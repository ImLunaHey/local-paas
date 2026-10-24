import type { VariantProps } from 'class-variance-authority'
import { cn } from 'cn'
import { statusTone, statusVariants } from './status-variants'

type StatusProps = VariantProps<typeof statusVariants> & { value: string; className?: string }

export function Status({ value, tone, className }: StatusProps) {
  return (
    <span className={cn(statusVariants({ tone: tone ?? statusTone(value) }), className)}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {value === 'active' ? 'Running' : value}
    </span>
  )
}
