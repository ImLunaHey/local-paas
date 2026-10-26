import { createAuthClient } from 'better-auth/react'
import { adminClient, organizationClient, usernameClient } from 'better-auth/client/plugins'
import { createAccessControl } from 'better-auth/plugins/access'

export const platformPermissions = {
  organization: ['update', 'delete'],
  member: ['create', 'update', 'delete'],
  invitation: ['create', 'cancel'],
  team: ['create', 'update', 'delete'],
  ac: ['create', 'read', 'update', 'delete'],
  project: ['read', 'create', 'update', 'delete'],
  service: ['read', 'create', 'update', 'delete'],
  build: ['read', 'execute', 'cancel'],
  deployment: ['read', 'execute', 'stop'],
  secret: ['read', 'manage'],
  node: ['read', 'manage'],
  job: ['read', 'execute', 'manage'],
  backup: ['read', 'manage'],
  audit: ['read'],
  domain: ['read', 'manage'],
  storage: ['read', 'manage'],
  source: ['read', 'manage'],
} as const

const accessControl = createAccessControl(platformPermissions)

export const authClient = createAuthClient({
  basePath: '/api/auth',
  plugins: [
    usernameClient(),
    adminClient(),
    organizationClient({
      ac: accessControl,
      teams: { enabled: true },
      dynamicAccessControl: { enabled: true },
    }),
  ],
})

export function isPlatformAdministrator(role: string | null | undefined) {
  return role
    ?.split(',')
    .map((value) => value.trim())
    .includes('admin')
}
