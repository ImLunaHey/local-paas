import { useState, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Building2, CreditCard, FolderKanban, Package, Users } from 'lucide-react'
import { api } from './api-client'
import { authClient, isPlatformAdministrator } from './auth-client'
import { Button } from './components/button'
import { Field } from './components/field'
import { Input } from './components/input'

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

export type PlatformAdminView = 'overview' | 'organizations' | 'users' | 'billing'

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
        <h2>Organizations</h2>
        <OrganizationList organizations={overview.organizations.slice(0, 5)} />
      </section>
    </div>
  )
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
            <div
              className="grid gap-2 rounded-md border border-zinc-800 p-4 sm:grid-cols-[1fr_auto] sm:items-center"
              key={user.id}
            >
              <div>
                <strong className="text-sm">{user.name}</strong>
                <p className="mt-1 text-xs text-muted">{user.email}</p>
              </div>
              <span className="text-xs text-muted">Global role: {user.role || 'user'}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
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
