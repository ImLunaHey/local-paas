import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { cn } from 'cn'
import { Layers3, LogOut } from 'lucide-react'
import { authClient, isPlatformAdministrator } from './auth-client'
import { Button } from './components/button'
import { Field } from './components/field'
import { Input } from './components/input'

export function AuthShell({ children }: { children: ReactNode }) {
  const session = authClient.useSession()
  const organizations = authClient.useListOrganizations()
  const activeOrganization = authClient.useActiveOrganization()
  const [activationError, setActivationError] = useState('')
  const isPlatformAdmin = isPlatformAdministrator(session.data?.user.role)

  useEffect(() => {
    const organization = organizations.data?.[0]
    if (
      !session.data ||
      isPlatformAdmin ||
      activeOrganization.isPending ||
      activeOrganization.data ||
      !organization
    )
      return
    void authClient.organization
      .setActive({ organizationId: organization.id })
      .then(({ error }) => {
        if (error) setActivationError(error.message || 'Could not select the organization')
      })
  }, [
    activeOrganization.data,
    activeOrganization.isPending,
    isPlatformAdmin,
    organizations.data,
    session.data,
  ])

  if (session.isPending) return <CenteredMessage>Checking your session…</CenteredMessage>
  if (!session.data) return <Login />
  if (isPlatformAdmin) return children
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
      <form
        className="w-full max-w-md rounded-lg border border-line bg-[light-dark(#f4f4f5,#131315)] p-7 shadow-[inset_0_1px_0_#ffffff04,0_8px_24px_#0000000d]"
        onSubmit={submit}
      >
        <div className="mb-7 flex items-center gap-3">
          <span className="grid size-[34px] place-items-center rounded-[9px] border border-zinc-300 bg-[linear-gradient(145deg,light-dark(#d4d4d8,#2b2b2f),light-dark(#f4f4f5,#18181b))] text-zinc-700">
            <Layers3 size={21} />
          </span>
          <div>
            <div className="mb-[13px] text-[9px] font-semibold tracking-[1.7px] text-zinc-500 uppercase">
              CONTROL PLANE
            </div>
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
      <section className="max-w-lg rounded-lg border border-line bg-[light-dark(#f4f4f5,#131315)] p-7 text-sm text-muted shadow-[inset_0_1px_0_#ffffff04,0_8px_24px_#0000000d]">
        {children}
      </section>
    </main>
  )
}

export function AccountMenu({ compact = false }: { compact?: boolean }) {
  const session = authClient.useSession()
  const activeOrganization = authClient.useActiveOrganization()
  const isPlatformAdmin = isPlatformAdministrator(session.data?.user.role)
  return (
    <div
      className={cn({
        'hidden items-center gap-1.5 max-[720px]:flex': compact,
        'border-t border-line px-3 pt-[22px] max-[720px]:hidden': !compact,
      })}
    >
      {!compact && (
        <span className="text-[9px] font-semibold tracking-[1.1px] text-muted">
          {isPlatformAdmin ? 'PLATFORM ADMIN' : activeOrganization.data?.name || 'ORGANIZATION'}
        </span>
      )}
      <span
        className={cn('flex items-center justify-between gap-2 text-xs', {
          'mt-2': !compact,
        })}
      >
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
