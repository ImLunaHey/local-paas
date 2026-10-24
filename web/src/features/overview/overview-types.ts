export interface Recent {
  id: string
  serviceId: string
  service: string
  project: string
  environment: string
  status: string
  createdAt: string
  errorCode: string | null
}
export interface OverviewData {
  summary: {
    projects: number
    services: number
    readyInstances: number
    healthyNodes: number
    totalNodes: number
    pendingBuilds: number
    failedDeployments: number
  }
  deployments: Recent[]
  builds: Recent[]
}
export interface HostSample {
  timestamp: string
  cpuPercent: number | null
  memoryUsedBytes: number | null
  memoryTotalBytes: number | null
  swapUsedBytes: number | null
  loadOne: number | null
  uptimeSeconds: number | null
  rootTotalBytes: number | null
  rootAvailableBytes: number | null
  networkRxBytesPerSecond: number | null
  networkTxBytesPerSecond: number | null
  diskReadBytesPerSecond: number | null
  diskWriteBytesPerSecond: number | null
}
export interface Node {
  id: string
  name: string
  healthy: boolean
  cordoned: boolean
  lastSeen: string | null
  cpuMillis: number
  memoryMib: number
  slots: number
  occupiedSlots: number
  reservedCpuMillis: number
  reservedMemoryMib: number
}
export interface HostsData {
  host: {
    name: string | null
    samples: HostSample[]
    bucketSeconds: number
    retentionDays: number
  }
  nodes: Node[]
}
