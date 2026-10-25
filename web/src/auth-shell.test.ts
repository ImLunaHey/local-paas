import { describe, expect, it } from 'vitest'
import { isPlatformAdministrator } from './auth-client'

describe('isPlatformAdministrator', () => {
  it('recognizes the global admin role', () => {
    expect(isPlatformAdministrator('admin')).toBe(true)
    expect(isPlatformAdministrator('user, admin')).toBe(true)
  })

  it('does not elevate organization roles', () => {
    expect(isPlatformAdministrator('user')).toBe(false)
    expect(isPlatformAdministrator(undefined)).toBeFalsy()
  })
})
