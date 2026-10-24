export interface Volume {
  id: string
  name: string
  sizeGib: number
  node: string | null
  services: { id: string; name: string; mountPath: string; readOnly: boolean }[]
}
