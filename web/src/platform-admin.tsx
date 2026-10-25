import { useState, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from '@tanstack/react-router'
import {
  ArrowLeft,
  Building2,
  CreditCard,
  FolderKanban,
  KeyRound,
  Package,
  Server,
  ShieldCheck,
  UserRound,
  Users,
} from 'lucide-react'
import { api } from './api-client'
import { authClient, isPlatformAdministrator } from './auth-client'
import { Button } from './components/button'
import { Field } from './components/field'
import { Input } from './components/input'
import { Select } from './components/select'
import { Hosts } from './features/overview/host-dashboard'
import type { HostsData } from './features/overview/overview-types'

type Organization = {
  id: string
  name: string
  slug: string
  createdAt: string
  memberCount: number
  projectCount: number
  serviceCount: number
}

type PlatformOverview = {
  organizations: Organization[]
  organizationCount: number
  userCount: number
  projectCount: number
  serviceCount: number
  billing: { configured: boolean; provider: string | null }
}

export type PlatformAdminView = 'overview' | 'organizations' | 'users' | 'host' | 'billing'

function overviewQuery() {
  return {
    queryKey: ['platform-admin', 'overview'],
    queryFn: () => api<PlatformOverview>('/platform-admin/overview'),
  }
}

export function PlatformAdmin({ view }: { view: PlatformAdminView }) {
  const session = authClient.useSession()
  const overview = useQuery(overviewQuery())
  if (!isPlatformAdministrator(session.data?.user.role)) {
    return (
      <section className="rounded-lg border border-line p-6">
        <h1>Platform administrator access required</h1>
        <p className="mt-3 text-sm text-muted">
          Organization roles cannot access installation-wide settings.
        </p>
      </section>
    )
  }
  if (overview.isPending) return <p className="text-sm text-muted">Loading platform…</p>
  if (overview.isError)
    return <p className="text-sm text-red-300">Could not load the platform overview.</p>
  if (view === 'organizations') return <Organizations overview={overview.data} />
  if (view === 'users') return <UsersView />
  if (view === 'host') return <Hosts />
  if (view === 'billing') return <Billing overview={overview.data} />
  return <Overview overview={overview.data} />
}

function PageHeading({ eyebrow, title, copy }: { eyebrow: string; title: string; copy: string }) {
  return (
    <div className="mb-[30px]">
      <div className="mb-[13px] text-[9px] font-semibold tracking-[1.7px] text-zinc-500 uppercase">
        {eyebrow}
      </div>
      <h1>{title}</h1>
      <p className="mt-3 text-xs text-muted">{copy}</p>
    </div>
  )
}

function Overview({ overview }: { overview: PlatformOverview }) {
  const host = useQuery({
    queryKey: ['platform-admin', 'host-summary'],
    queryFn: () => api<HostsData>('/hosts?range=15m'),
    refetchInterval: 15_000,
  })
  const latestHostSample = host.data?.host.samples.at(-1)
  const healthyNodes = host.data?.nodes.filter((node) => node.healthy).length ?? 0
  const metrics = [
    ['Organizations', overview.organizationCount, Building2],
    ['Users', overview.userCount, Users],
    ['Projects', overview.projectCount, FolderKanban],
    ['Services', overview.serviceCount, Package],
  ] as const
  return (
    <div>
      <PageHeading
        eyebrow="PLATFORM ADMIN"
        title="Platform overview"
        copy="Installation-wide organizations, accounts, workloads, and commercial settings."
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map(([label, value, Icon]) => (
          <section className="rounded-lg border border-line p-5" key={label}>
            <div className="flex items-center justify-between text-muted">
              <span className="text-xs">{label}</span>
              <Icon size={17} />
            </div>
            <strong className="mt-5 block text-3xl font-semibold">{value}</strong>
          </section>
        ))}
      </div>
      <section className="mt-5 rounded-lg border border-line p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <Server className="mt-0.5 text-muted" size={20} />
            <div>
              <h2>{host.data?.host.name || 'Controller host'}</h2>
              <p className="mt-2 text-xs text-muted">
                {host.isPending
                  ? 'Loading host measurements…'
                  : host.isError
                    ? 'Host measurements are currently unavailable.'
                    : `${healthyNodes} of ${host.data.nodes.length} workers healthy`}
              </p>
            </div>
          </div>
          <Link className="text-xs text-orange-300 hover:text-orange-200" to="/platform/host">
            View host details
          </Link>
        </div>
        {latestHostSample && (
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <HostMetric label="CPU" value={formatMeasurement(latestHostSample.cpuPercent, '%')} />
            <HostMetric
              label="Memory used"
              value={formatMeasurement(
                latestHostSample.memoryUsedBytes == null
                  ? null
                  : latestHostSample.memoryUsedBytes / 2 ** 30,
                ' GiB',
              )}
            />
            <HostMetric
              label="Uptime"
              value={
                latestHostSample.uptimeSeconds == null
                  ? '—'
                  : `${Math.floor(latestHostSample.uptimeSeconds / 86_400)} days`
              }
            />
          </div>
        )}
      </section>
      <section className="mt-5 rounded-lg border border-line p-6">
        <h2>Organizations</h2>
        <OrganizationList organizations={overview.organizations.slice(0, 5)} />
      </section>
    </div>
  )
}

function HostMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-zinc-800 p-4">
      <span className="text-[10px] font-semibold tracking-wide text-muted uppercase">{label}</span>
      <strong className="mt-2 block text-lg font-semibold">{value}</strong>
    </div>
  )
}

function formatMeasurement(value: number | null, unit: string) {
  return value == null ? '—' : `${value.toFixed(1)}${unit}`
}

function Organizations({ overview }: { overview: PlatformOverview }) {
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setPending(true)
    setError('')
    try {
      const result = await authClient.organization.create({
        name,
        slug,
        keepCurrentActiveOrganization: true,
      })
      if (result.error) {
        setError(result.error.message || 'Could not create organization')
        return
      }
      window.location.reload()
    } catch {
      setError('The authentication service is unavailable')
    } finally {
      setPending(false)
    }
  }

  return (
    <div>
      <PageHeading
        eyebrow="PLATFORM ADMIN"
        title="Organizations"
        copy="Create and inspect every tenant on this installation."
      />
      <section className="rounded-lg border border-line p-6">
        <h2>Create organization</h2>
        <form className="mt-5 grid gap-3 sm:grid-cols-[1fr_1fr_auto]" onSubmit={submit}>
          <Field label="Name">
            <Input required value={name} onChange={(event) => setName(event.target.value)} />
          </Field>
          <Field label="Slug" hint={error || undefined}>
            <Input
              aria-invalid={Boolean(error)}
              pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
              required
              value={slug}
              onChange={(event) => setSlug(event.target.value)}
            />
          </Field>
          <Button className="self-end" disabled={pending} type="submit">
            {pending ? 'Creating…' : 'Create'}
          </Button>
        </form>
      </section>
      <section className="mt-5 rounded-lg border border-line p-6">
        <h2>All organizations</h2>
        <OrganizationList organizations={overview.organizations} />
      </section>
    </div>
  )
}

function OrganizationList({ organizations }: { organizations: Organization[] }) {
  if (!organizations.length) return <p className="mt-4 text-sm text-muted">No organizations yet.</p>
  return (
    <div className="mt-4 grid gap-2">
      {organizations.map((organization) => (
        <div
          className="grid gap-3 rounded-md border border-zinc-800 p-4 md:grid-cols-[1fr_auto_auto_auto] md:items-center"
          key={organization.id}
        >
          <div>
            <strong className="text-sm">{organization.name}</strong>
            <p className="mt-1 text-xs text-muted">{organization.slug}</p>
          </div>
          <Metric label="Members" value={organization.memberCount} />
          <Metric label="Projects" value={organization.projectCount} />
          <Metric label="Services" value={organization.serviceCount} />
        </div>
      ))}
    </div>
  )
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <span className="text-xs text-muted">
      <strong className="mr-1 text-zinc-200">{value}</strong>
      {label}
    </span>
  )
}

function UsersView() {
  const users = useQuery({
    queryKey: ['platform-admin', 'users'],
    queryFn: async () => {
      const result = await authClient.admin.listUsers({ query: { limit: 100 } })
      if (result.error) throw new Error(result.error.message || 'Could not load users')
      return result.data
    },
  })
  return (
    <div>
      <PageHeading
        eyebrow="PLATFORM ADMIN"
        title="Users"
        copy="Installation accounts and their global roles. Organization access is managed inside each organization."
      />
      <section className="rounded-lg border border-line p-6">
        {users.isPending && <p className="text-sm text-muted">Loading users…</p>}
        {users.isError && <p className="text-sm text-red-300">Could not load users.</p>}
        <div className="grid gap-2">
          {users.data?.users.map((user) => (
            <Link
              to="/platform/users/$userId"
              params={{ userId: user.id }}
              className="grid gap-2 rounded-md border border-zinc-800 p-4 sm:grid-cols-[1fr_auto] sm:items-center"
              key={user.id}
            >
              <div>
                <strong className="text-sm">{user.name}</strong>
                <p className="mt-1 text-xs text-muted">{user.email}</p>
              </div>
              <span className="text-xs text-muted">Global role: {user.role || 'user'}</span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  )
}

export function PlatformUserDetail() {
  const session = authClient.useSession()
  const { userId } = useParams({ strict: false }) as { userId: string }
  const user = useQuery({
    queryKey: ['platform-admin', 'user', userId],
    queryFn: async () => {
      const result = await authClient.admin.getUser({ query: { id: userId } })
      if (result.error) throw new Error(result.error.message || 'Could not load user')
      return result.data
    },
  })
  const sessions = useQuery({
    queryKey: ['platform-admin', 'user', userId, 'sessions'],
    queryFn: async () => {
      const result = await authClient.admin.listUserSessions({ userId })
      if (result.error) throw new Error(result.error.message || 'Could not load sessions')
      return result.data.sessions
    },
  })

  if (!isPlatformAdministrator(session.data?.user.role)) {
    return (
      <section className="rounded-lg border border-line p-6">
        <h1>Platform administrator access required</h1>
        <p className="mt-3 text-sm text-muted">
          Organization roles cannot access installation-wide user profiles.
        </p>
      </section>
    )
  }
  if (user.isPending) return <p className="text-sm text-muted">Loading user…</p>
  if (user.isError || !user.data)
    return <p className="text-sm text-red-300">Could not load this user.</p>

  return (
    <div>
      <Link
        className="mb-5 inline-flex items-center gap-2 text-xs text-muted hover:text-zinc-200"
        to="/platform/users"
      >
        <ArrowLeft size={14} /> All users
      </Link>
      <PageHeading
        eyebrow="PLATFORM ADMIN / USER"
        title={user.data.name}
        copy="Manage this account's profile, global access, suspension state, and active sessions."
      />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(300px,0.55fr)]">
        <UserProfileForm
          currentUserId={session.data?.user.id}
          onUpdated={() => void user.refetch()}
          user={user.data}
        />
        <div className="grid content-start gap-5">
          <AccountSummary user={user.data} />
          <SessionManager
            currentUserId={session.data?.user.id}
            sessions={sessions.data ?? []}
            sessionsPending={sessions.isPending}
            userId={userId}
            onRevoked={() => void sessions.refetch()}
          />
        </div>
      </div>
    </div>
  )
}

type ManagedUser = NonNullable<Awaited<ReturnType<typeof authClient.admin.getUser>>['data']>

function UserProfileForm({
  currentUserId,
  onUpdated,
  user,
}: {
  currentUserId: string | undefined
  onUpdated: () => void
  user: ManagedUser
}) {
  const queryClient = useQueryClient()
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const isCurrentUser = currentUserId === user.id

  async function submit(event: FormEvent) {
    event.preventDefault()
    const form = new FormData(event.currentTarget as HTMLFormElement)
    const name = String(form.get('name') ?? '')
    const email = String(form.get('email') ?? '')
    const username = String(form.get('username') ?? '')
    const currentRole = isPlatformAdministrator(user.role) ? 'admin' : 'user'
    const selectedRole = form.get('role') === 'admin' ? 'admin' : 'user'
    const role = isCurrentUser ? currentRole : selectedRole
    setPending(true)
    setMessage('')
    setError('')
    try {
      const profileResult = await authClient.admin.updateUser({
        userId: user.id,
        data: { name, email, username },
      })
      if (profileResult.error)
        throw new Error(profileResult.error.message || 'Could not update profile')
      if (role !== currentRole) {
        const roleResult = await authClient.admin.setRole({ userId: user.id, role })
        if (roleResult.error) throw new Error(roleResult.error.message || 'Could not update role')
      }
      await queryClient.invalidateQueries({ queryKey: ['platform-admin', 'users'] })
      setMessage('User profile updated.')
      onUpdated()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not update user')
    } finally {
      setPending(false)
    }
  }

  return (
    <section className="rounded-lg border border-line p-6">
      <div className="flex items-center gap-3">
        <UserRound className="text-muted" size={20} />
        <h2>Profile</h2>
      </div>
      <form className="mt-5 grid gap-4" onSubmit={submit}>
        <Field label="Display name">
          <Input defaultValue={user.name} name="name" required />
        </Field>
        <Field label="Email address">
          <Input defaultValue={user.email} name="email" required type="email" />
        </Field>
        <Field label="Username" hint="Used to sign in to this installation.">
          <Input
            defaultValue={user.username ?? ''}
            name="username"
            pattern="[A-Za-z0-9_]+"
            required
          />
        </Field>
        <Field
          label="Global role"
          hint={
            isCurrentUser ? 'You cannot remove your own platform administrator role.' : undefined
          }
        >
          <Select
            defaultValue={isPlatformAdministrator(user.role) ? 'admin' : 'user'}
            disabled={isCurrentUser}
            name="role"
          >
            <option value="user">User</option>
            <option value="admin">Platform administrator</option>
          </Select>
        </Field>
        {message && (
          <p className="text-xs text-emerald-300" role="status">
            {message}
          </p>
        )}
        {error && (
          <p className="text-xs text-red-300" role="alert">
            {error}
          </p>
        )}
        <Button className="justify-self-start" disabled={pending} type="submit" variant="primary">
          {pending ? 'Saving…' : 'Save changes'}
        </Button>
      </form>
      <SuspensionControls currentUserId={currentUserId} onUpdated={onUpdated} user={user} />
    </section>
  )
}

function SuspensionControls({
  currentUserId,
  onUpdated,
  user,
}: {
  currentUserId: string | undefined
  onUpdated: () => void
  user: ManagedUser
}) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const isCurrentUser = currentUserId === user.id

  async function toggleSuspension() {
    setPending(true)
    setError('')
    try {
      const result = user.banned
        ? await authClient.admin.unbanUser({ userId: user.id })
        : await authClient.admin.banUser({
            userId: user.id,
            banReason: 'Suspended by platform administrator',
          })
      if (result.error) throw new Error(result.error.message || 'Could not update suspension')
      onUpdated()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not update suspension')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="mt-7 border-t border-line pt-5">
      <h3 className="text-sm font-medium">Account access</h3>
      <p className="mt-2 text-xs leading-relaxed text-muted">
        {user.banned
          ? 'This account is suspended and cannot create new sessions.'
          : 'Suspension blocks new sign-ins. Existing sessions can be revoked separately.'}
      </p>
      {error && (
        <p className="mt-3 text-xs text-red-300" role="alert">
          {error}
        </p>
      )}
      <Button
        className="mt-4 border-red-400/30 text-red-300 hover:border-red-400/60 hover:bg-red-400/10"
        disabled={isCurrentUser || pending}
        onClick={() => void toggleSuspension()}
      >
        {pending ? 'Updating…' : user.banned ? 'Restore account' : 'Suspend account'}
      </Button>
    </div>
  )
}

function AccountSummary({ user }: { user: ManagedUser }) {
  const facts = [
    ['User ID', user.id],
    ['Email verified', user.emailVerified ? 'Yes' : 'No'],
    ['Created', formatDate(user.createdAt)],
    ['Updated', formatDate(user.updatedAt)],
    ['Status', user.banned ? 'Suspended' : 'Active'],
  ]
  return (
    <section className="rounded-lg border border-line p-6">
      <div className="flex items-center gap-3">
        <ShieldCheck className="text-muted" size={20} />
        <h2>Account</h2>
      </div>
      <dl className="mt-5 grid gap-4">
        {facts.map(([label, value]) => (
          <div className="grid gap-1" key={label}>
            <dt className="text-[10px] font-semibold tracking-wide text-muted uppercase">
              {label}
            </dt>
            <dd className="break-all text-xs text-zinc-200">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

type ManagedSession = Awaited<
  ReturnType<typeof authClient.admin.listUserSessions>
>['data']['sessions'][number]

function SessionManager({
  currentUserId,
  onRevoked,
  sessions,
  sessionsPending,
  userId,
}: {
  currentUserId: string | undefined
  onRevoked: () => void
  sessions: ManagedSession[]
  sessionsPending: boolean
  userId: string
}) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const isCurrentUser = currentUserId === userId

  async function revokeAll() {
    setPending(true)
    setError('')
    try {
      const result = await authClient.admin.revokeUserSessions({ userId })
      if (result.error) throw new Error(result.error.message || 'Could not revoke sessions')
      onRevoked()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not revoke sessions')
    } finally {
      setPending(false)
    }
  }

  return (
    <section className="rounded-lg border border-line p-6">
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-3">
          <KeyRound className="text-muted" size={20} />
          <h2>Sessions</h2>
        </span>
        <span className="text-xs text-muted">{sessions.length} active</span>
      </div>
      {sessionsPending && <p className="mt-4 text-xs text-muted">Loading sessions…</p>}
      {!sessionsPending && !sessions.length && (
        <p className="mt-4 text-xs text-muted">No active sessions.</p>
      )}
      <div className="mt-4 grid gap-2">
        {sessions.map((item) => (
          <div className="rounded-md border border-zinc-800 p-3" key={item.id}>
            <p className="truncate text-xs text-zinc-200">{item.userAgent || 'Unknown client'}</p>
            <p className="mt-1 text-[11px] text-muted">
              {item.ipAddress || 'Unknown address'} · expires {formatDate(item.expiresAt)}
            </p>
          </div>
        ))}
      </div>
      {error && (
        <p className="mt-3 text-xs text-red-300" role="alert">
          {error}
        </p>
      )}
      <Button
        className="mt-4"
        disabled={isCurrentUser || pending || !sessions.length}
        onClick={() => void revokeAll()}
      >
        {pending ? 'Revoking…' : 'Revoke all sessions'}
      </Button>
      {isCurrentUser && (
        <p className="mt-2 text-[11px] text-muted">Sign out normally to end your own session.</p>
      )}
    </section>
  )
}

function formatDate(value: string | Date) {
  return new Date(value).toLocaleString()
}

function Billing({ overview }: { overview: PlatformOverview }) {
  return (
    <div>
      <PageHeading
        eyebrow="PLATFORM ADMIN"
        title="Billing"
        copy="Installation-wide billing provider, plans, invoices, and organization entitlements."
      />
      <section className="rounded-lg border border-line p-6">
        <div className="flex items-center gap-3">
          <CreditCard className="text-muted" size={20} />
          <div>
            <h2>
              {overview.billing.configured ? 'Billing connected' : 'Billing is not configured'}
            </h2>
            <p className="mt-2 text-sm text-muted">
              {overview.billing.provider
                ? `Provider: ${overview.billing.provider}`
                : 'No provider, plans, invoices, or entitlements are being claimed by this installation.'}
            </p>
          </div>
        </div>
      </section>
    </div>
  )
}
