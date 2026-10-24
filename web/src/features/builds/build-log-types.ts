export interface LogPage {
  entries: { sequence: number; message: string }[]
  nextCursor: number
  truncated: boolean
}
export interface AccumulatedLogs {
  text: string
  cursor: number
  truncated: boolean
}
