import { Button } from './button'

export function ErrorNotice({ error, retry }: { error: Error; retry?: () => void }) {
  return (
    <div
      className="error-notice [border:1px_solid_#4d2b2d] [background:light-dark(#f4f4f5,_#231719)] [border-radius:7px] [padding:18px] [font-size:12px] [color:#ffb4ae] [line-height:1.8] [overflow-wrap:anywhere] [&_p]:[margin-top:5px]"
      role="alert"
    >
      <strong>Something needs attention</strong>
      <p className="whitespace-pre-line">{error.message}</p>
      {retry && (
        <Button
          className="button secondary mt-3 [display:inline-flex] [align-items:center] [justify-content:center] [gap:8px] [font-size:11px] [font-weight:600] [line-height:1] [white-space:nowrap] [border:1px_solid_transparent] [border-radius:6px] [padding:12px_15px] [&.primary]:[background:#ff8a4c] [&.primary]:[color:#1b100a] [&.primary]:[border-color:#ff8a4c] [&.primary:hover]:[background:#ffa36c] [&.secondary]:[background:light-dark(#e4e4e7,_#1b1b1e)] [&.secondary]:[border-color:light-dark(#d4d4d8,_#38383c)] [&.secondary]:[color:light-dark(#27272a,_#e7e7eb)] [&.secondary:hover]:[background:light-dark(#e4e4e7,_#1b1b1e)]"
          onClick={retry}
        >
          Try again
        </Button>
      )}
    </div>
  )
}
