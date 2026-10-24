import { cn } from 'cn'
import { type ButtonHTMLAttributes } from 'react'
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
        : 'border-[light-dark(#d4d4d8,#38383c)] bg-[light-dark(#e4e4e7,#1b1b1e)] text-zinc-200 hover:border-zinc-500 hover:bg-[light-dark(#e4e4e7,#232327)]'
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
