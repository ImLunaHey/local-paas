import { api } from './api-client'
export interface Domain {
  hostname: string
  serviceId: string | null
  service: string | null
}
export const domainsQuery = {
  queryKey: ['domains'],
  queryFn: () => api<{ items: Domain[] }>('/domains'),
}
