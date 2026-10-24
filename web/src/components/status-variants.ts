import { cva } from 'class-variance-authority'

export const statusVariants = cva(
  'inline-flex items-center gap-1.5 rounded border px-2 py-1 text-[10px] capitalize',
  {
    variants: {
      tone: {
        healthy: 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300',
        error: 'border-red-400/20 bg-red-400/10 text-red-300',
        pending: 'border-orange-400/20 bg-orange-400/10 text-orange-300',
        neutral: 'border-zinc-700 bg-zinc-800/40 text-zinc-400',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
)

export function statusTone(value: string) {
  if (['active', 'succeeded', 'Running', 'Healthy'].includes(value)) return 'healthy'
  if (['failed', 'Unavailable', 'Offline'].includes(value)) return 'error'
  if (['preparing', 'queued', 'running'].includes(value)) return 'pending'
  return 'neutral'
}
