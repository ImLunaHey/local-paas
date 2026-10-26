// @vitest-environment node
import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { platformPermissions } from '../src/auth-client'

test('the custom role editor exposes every backend platform resource and action', () => {
  const auth = readFileSync(
    new URL('../../crates/control-plane/src/auth.rs', import.meta.url),
    'utf8',
  )
  const declaration = auth.match(/pub const PERMISSION_RESOURCES[^=]*= &\[([\s\S]*?)\n\];/)
  expect(declaration, 'backend permission declaration must be readable').not.toBeNull()
  const resources = declaration![1]
  const entry = /\("([^"]+)", &\[([^\]]+)\]\)/g
  const backend = Object.fromEntries(
    [...resources.matchAll(entry)].map((match) => [match[1], JSON.parse(`[${match[2]}]`)]),
  )
  // Fail if Rust changes to a format this check cannot completely read.
  expect(resources.replace(entry, '').replace(/[\s,]/g, '')).toBe('')
  expect(Object.keys(backend).length).toBeGreaterThan(0)
  // These organization-plugin permissions are separate from PERMISSION_RESOURCES.
  expect(platformPermissions).toEqual({
    organization: ['update', 'delete'],
    member: ['create', 'update', 'delete'],
    invitation: ['create', 'cancel'],
    team: ['create', 'update', 'delete'],
    ac: ['create', 'read', 'update', 'delete'],
    ...backend,
  })
})
