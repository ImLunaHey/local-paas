import { AlertCircle } from 'lucide-react'
export function diagnosticSummary(code: string): string {
  if (
    code.includes('no such image') ||
    code.includes('image_configuration') ||
    code === 'image_command_missing'
  )
    return 'Could not read image configuration'
  if (code.includes('secret_delivery')) return 'Could not retrieve workload secrets'
  if (code.includes('secret_materialization') || code.includes('secret_files'))
    return 'Could not prepare workload secrets'
  if (code === 'readiness_pending') return 'Waiting for the application to become ready'
  if (code === 'readiness_failed') return 'Application did not pass its readiness check'
  if (code === 'process_exited') return 'Application process exited'
  if (code.includes('start_failed')) return 'Application could not start'
  if (code.includes('prepare_failed') || code.includes('runtime_command_failed'))
    return 'Instance preparation failed'
  if (code.includes('cleanup_failed')) return 'Instance cleanup could not finish'
  if (code.includes('permission')) return 'Runtime permission check failed'
  return 'Runtime operation failed'
}
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
