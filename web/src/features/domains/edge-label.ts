export function edgeLabel(status: string) {
  if (status === 'active') return 'Public route active'
  if (status === 'pending-edge') return 'Pending edge acknowledgement'
  if (status === 'waiting-deployment') return 'Waiting for deployment'
  return status.replaceAll(/[-_]/g, ' ')
}
