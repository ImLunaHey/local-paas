export interface Options {
  command: string[]
  timeoutSeconds: number
}
export interface Schedule {
  version: number
  revisionId: string
  options: Options
  intervalMinutes: number
  status: 'enabled' | 'paused'
  nextRunAt: string
}
export interface Run {
  id: string
  revisionId: string
  options: Options
  status: string
  result: { outcome: string; exitCode: number | null } | null
  createdAt: string
  completedAt: string | null
  instanceId: string | null
  node: string | null
  cleanupPending: boolean
  errorCode: string | null
}
export interface Jobs {
  runs: Run[]
  schedule: Schedule | null
  occurrences: {
    id: string
    scheduledAt: string
    status: string
    skippedCount: number
  }[]
}
export interface Draft {
  revision: string
  executable: string
  arguments: string
  timeout: number
}
