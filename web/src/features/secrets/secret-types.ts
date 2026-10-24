export interface SecretSet {
  configured: boolean
  version: number
  names: string[]
  ownNames: string[]
  origins: Record<string, string>
  references: string[]
  path: string
}
