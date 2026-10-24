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
  if (code === 'restart_backoff') return 'Application exited; waiting before restarting'
  if (code === 'crash_loop')
    return 'Application stopped after five restart attempts; deploy again to retry'
  if (code === 'recovery_state_unavailable')
    return 'Restart history could not be saved; automatic recovery is paused'
  if (code === 'process_exited') return 'Application process exited'
  if (code.includes('start_failed')) return 'Application could not start'
  if (code.includes('prepare_failed') || code.includes('runtime_command_failed'))
    return 'Instance preparation failed'
  if (code.includes('cleanup_failed')) return 'Instance cleanup could not finish'
  if (code.includes('permission')) return 'Runtime permission check failed'
  return 'Runtime operation failed'
}
