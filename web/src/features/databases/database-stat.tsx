export function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="panel min-w-0 p-5 [background:light-dark(#f4f4f5,_#131315)] [border:1px_solid_light-dark(#e4e4e7,_#28282c)] [border-radius:8px] [box-shadow:0_1px_0_#ffffff04_inset,_0_8px_24px_#0000000d]">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-3 text-2xl font-medium tabular-nums">{value}</p>
      <p className="mt-2 text-xs text-muted">{hint}</p>
    </div>
  )
}
