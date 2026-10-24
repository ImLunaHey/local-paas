import { cn } from 'cn'
import { cva, type VariantProps } from 'class-variance-authority'
import { type ButtonHTMLAttributes } from 'react'

const buttonVariants = cva(
  'inline-flex min-h-11 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md border px-4 py-2.5 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-orange-400/50 disabled:cursor-not-allowed disabled:opacity-40',
  {
    variants: {
      variant: {
        primary: 'border-[#ff8a4c] bg-[#ff8a4c] text-[#1b100a] hover:bg-[#ffa36c]',
        ghost:
          'border-transparent bg-transparent text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100',
        secondary:
          'border-[light-dark(#d4d4d8,#38383c)] bg-[light-dark(#e4e4e7,#1b1b1e)] text-zinc-200 hover:border-zinc-500 hover:bg-[light-dark(#e4e4e7,#232327)]',
      },
    },
    defaultVariants: { variant: 'secondary' },
  },
)

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>

export function Button({ className = '', variant, type = 'button', ...props }: ButtonProps) {
  return <button {...props} type={type} className={cn(buttonVariants({ variant }), className)} />
}
