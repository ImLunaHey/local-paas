export function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="panel min-w-0 p-5">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-3 text-2xl font-medium tabular-nums">{value}</p>
      <p className="mt-2 text-xs text-muted">{hint}</p>
    </div>
  )
}
