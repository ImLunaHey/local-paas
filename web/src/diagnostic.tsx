import { AlertCircle } from 'lucide-react'
import { diagnosticSummary } from './diagnostic-summary'
export function Diagnostic({ code }: { code: string }) {
  return (
    <div className="mt-3 min-w-0 rounded-md border border-red-400/15 bg-red-400/5 px-3 py-2.5">
      <p className="flex items-center gap-2 text-xs text-red-200">
        <AlertCircle size={13} className="shrink-0" />
        {diagnosticSummary(code)}
      </p>
      <details className="mt-2 text-[11px] text-zinc-400">
        <summary className="cursor-pointer hover:text-zinc-200">Technical details</summary>
        <pre className="mt-2 whitespace-pre-wrap break-all rounded bg-black/20 p-2 font-mono leading-relaxed">
          {code.replaceAll('\\n', '\n')}
        </pre>
      </details>
    </div>
  )
}
