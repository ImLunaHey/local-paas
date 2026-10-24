import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Layers3, LogOut } from 'lucide-react'
import { authClient } from './auth-client'
import { Button } from './components/button'
import { Field } from './components/field'
import { Input } from './components/input'

export function AuthShell({ children }: { children: ReactNode }) {
  const session = authClient.useSession()
  const organizations = authClient.useListOrganizations()
  const activeOrganization = authClient.useActiveOrganization()
  const [activationError, setActivationError] = useState('')

  useEffect(() => {
    const organization = organizations.data?.[0]
    if (!session.data || activeOrganization.isPending || activeOrganization.data || !organization)
      return
    void authClient.organization
      .setActive({ organizationId: organization.id })
      .then(({ error }) => {
        if (error) setActivationError(error.message || 'Could not select the organization')
      })
  }, [activeOrganization.data, activeOrganization.isPending, organizations.data, session.data])

  if (session.isPending) return <CenteredMessage>Checking your session…</CenteredMessage>
  if (!session.data) return <Login />
  if (organizations.isPending || activeOrganization.isPending)
    return <CenteredMessage>Loading your organization…</CenteredMessage>
  if (activationError) return <CenteredMessage>{activationError}</CenteredMessage>
  if (!activeOrganization.data)
    return (
      <CenteredMessage>
        Your account does not belong to an organization. Ask an administrator for an invitation.
      </CenteredMessage>
    )
  return children
}

function Login() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError('')
    setPending(true)
    try {
      const result = await authClient.signIn.username({ username, password })
      if (result.error) setError(result.error.message || 'The username or password is incorrect')
      else window.location.reload()
    } catch {
      setError('The authentication service is unavailable')
    } finally {
      setPending(false)
    }
  }

  return (
    <main className="grid min-h-screen place-items-center p-6">
      <form className="panel w-full max-w-md p-7" onSubmit={submit}>
        <div className="mb-7 flex items-center gap-3">
          <span className="brand-mark">
            <Layers3 size={21} />
          </span>
          <div>
            <div className="eyebrow">CONTROL PLANE</div>
            <h1 className="mt-1 text-xl">Sign in to local-paas</h1>
          </div>
        </div>
        <div className="grid gap-5">
          <Field label="Username" hint={error || undefined}>
            <Input
              aria-invalid={Boolean(error)}
              autoComplete="username"
              name="username"
              required
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
          </Field>
          <Field label="Password">
            <Input
              autoComplete="current-password"
              name="password"
              required
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>
          <Button disabled={pending} type="submit">
            {pending ? 'Signing in…' : 'Sign in'}
          </Button>
        </div>
      </form>
    </main>
  )
}

function CenteredMessage({ children }: { children: ReactNode }) {
  return (
    <main className="grid min-h-screen place-items-center p-6">
      <section className="panel max-w-lg p-7 text-sm text-muted">{children}</section>
    </main>
  )
}

export function AccountMenu({ compact = false }: { compact?: boolean }) {
  const session = authClient.useSession()
  const activeOrganization = authClient.useActiveOrganization()
  return (
    <div className={compact ? 'mobile-account-menu' : 'sidebar-bottom'}>
      {!compact && (
        <span className="tiny-label">{activeOrganization.data?.name || 'ORGANIZATION'}</span>
      )}
      <span className="mt-2 flex items-center justify-between gap-2 text-xs">
        <span className="min-w-0 truncate">{session.data?.user.name}</span>
        <Button
          aria-label="Sign out"
          className="min-h-8 px-2"
          variant="ghost"
          onClick={() => void authClient.signOut()}
        >
          <LogOut size={14} />
        </Button>
      </span>
    </div>
  )
}
