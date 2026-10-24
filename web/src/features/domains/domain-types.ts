export interface Domain {
  hostname: string
  serviceId: string | null
  version: number
  project: string | null
  projectId: string | null
  environment: string | null
  service: string | null
}
export interface DomainList {
  items: Domain[]
  cnameTarget: string | null
  edgeReady: false
}
