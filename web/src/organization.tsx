import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { authClient, platformPermissions } from './auth-client'
import { Button } from './components/button'
import { Field } from './components/field'
import { Input } from './components/input'
import { Select } from './components/select'

type OrganizationRole = {
  id: string
  role: string
  permission: Record<string, string[]>
}

type OrganizationTeam = {
  id: string
  name: string
}

const builtInRoles = ['owner', 'admin', 'operator', 'viewer', 'member']

export function OrganizationSettings() {
  const organization = authClient.useActiveOrganization()
  const [roles, setRoles] = useState<OrganizationRole[]>([])
  const [teams, setTeams] = useState<OrganizationTeam[]>([])
  const [error, setError] = useState('')
  const organizationId = organization.data?.id

  const refreshRoles = useCallback(async () => {
    if (!organizationId) return
    const result = await authClient.organization.listRoles({ query: { organizationId } })
    if (result.error) setError(result.error.message || 'Could not load roles')
    else setRoles(result.data || [])
  }, [organizationId])

  const refreshTeams = useCallback(async () => {
    if (!organizationId) return
    const result = await authClient.organization.listTeams({ query: { organizationId } })
    if (result.error) setError(result.error.message || 'Could not load teams')
    else setTeams(result.data || [])
  }, [organizationId])

  useEffect(() => void refreshRoles(), [refreshRoles])
  useEffect(() => void refreshTeams(), [refreshTeams])

  if (!organization.data) return null
  const roleNames = [...builtInRoles, ...roles.map((role) => role.role)]
  return (
    <div>
      <div className="page-heading">
        <div>
          <div className="eyebrow">ORGANIZATION</div>
          <h1>{organization.data.name}</h1>
          <p>Manage members, teams, and organization-specific access roles.</p>
        </div>
      </div>
      {error && <p className="mb-4 text-sm text-red-300">{error}</p>}
      <div className="grid gap-5 xl:grid-cols-2">
        <section className="panel p-6">
          <h2>Members</h2>
          <div className="mt-4 grid gap-2">
            {organization.data.members.map((member) => (
              <div
                className="grid gap-1 rounded-md border border-zinc-800 p-3 sm:grid-cols-[1fr_10rem] sm:items-center"
                key={member.id}
              >
                <span className="min-w-0 truncate text-sm">
                  {member.user.name || member.user.email}
                </span>
                <Select
                  aria-label={`Role for ${member.user.name || member.user.email}`}
                  value={member.role}
                  onChange={async (event) => {
                    const result = await authClient.organization.updateMemberRole({
                      memberId: member.id,
                      role: event.target.value,
                    })
                    if (result.error)
                      setError(result.error.message || 'Could not update member role')
                    else await organization.refetch()
                  }}
                >
                  {roleNames.map((name) => (
                    <option key={name}>{name}</option>
                  ))}
                </Select>
              </div>
            ))}
          </div>
          <InviteMember roles={roleNames} onError={setError} />
        </section>
        <section className="panel p-6">
          <h2>Teams</h2>
          <div className="mt-4 grid gap-2">
            {teams.map((team) => (
              <div className="rounded-md border border-zinc-800 p-3 text-sm" key={team.id}>
                {team.name}
              </div>
            ))}
          </div>
          <CreateTeam onCreated={refreshTeams} onError={setError} />
        </section>
      </div>
      <section className="panel mt-5 p-6">
        <h2>Custom roles</h2>
        <p className="mt-2 text-sm text-muted">
          Roles are scoped to this organization and can combine any platform permissions.
        </p>
        <div className="mt-4 grid gap-2">
          {roles.map((role) => (
            <div className="rounded-md border border-zinc-800 p-3" key={role.id}>
              <strong className="text-sm">{role.role}</strong>
              <p className="mt-1 text-xs text-muted">
                {Object.entries(role.permission)
                  .map(([resource, actions]) => `${resource}: ${actions.join(', ')}`)
                  .join(' · ')}
              </p>
            </div>
          ))}
        </div>
        <CreateRole onCreated={refreshRoles} onError={setError} />
      </section>
    </div>
  )
}

function InviteMember({ roles, onError }: { roles: string[]; onError: (message: string) => void }) {
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('operator')
  async function submit(event: FormEvent) {
    event.preventDefault()
    const result = await authClient.organization.inviteMember({ email, role })
    if (result.error) onError(result.error.message || 'Could not invite member')
    else setEmail('')
  }
  return (
    <form className="mt-5 grid gap-3 sm:grid-cols-[1fr_10rem_auto]" onSubmit={submit}>
      <Field label="Email">
        <Input
          required
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </Field>
      <Field label="Role">
        <Select value={role} onChange={(event) => setRole(event.target.value)}>
          {roles.map((name) => (
            <option key={name}>{name}</option>
          ))}
        </Select>
      </Field>
      <Button className="self-end" type="submit">
        Invite
      </Button>
    </form>
  )
}

function CreateTeam({
  onCreated,
  onError,
}: {
  onCreated: () => Promise<void>
  onError: (message: string) => void
}) {
  const [name, setName] = useState('')
  async function submit(event: FormEvent) {
    event.preventDefault()
    const result = await authClient.organization.createTeam({ name })
    if (result.error) onError(result.error.message || 'Could not create team')
    else {
      setName('')
      await onCreated()
    }
  }
  return (
    <form className="mt-5 flex items-end gap-3" onSubmit={submit}>
      <Field label="Team name">
        <Input required value={name} onChange={(event) => setName(event.target.value)} />
      </Field>
      <Button type="submit">Create</Button>
    </form>
  )
}

function CreateRole({
  onCreated,
  onError,
}: {
  onCreated: () => Promise<void>
  onError: (message: string) => void
}) {
  const [name, setName] = useState('')
  const [selected, setSelected] = useState<Record<string, string[]>>({})
  function toggle(resource: string, action: string, checked: boolean) {
    setSelected((current) => ({
      ...current,
      [resource]: checked
        ? [...(current[resource] || []), action]
        : (current[resource] || []).filter((value) => value !== action),
    }))
  }
  async function submit(event: FormEvent) {
    event.preventDefault()
    const permission = Object.fromEntries(
      Object.entries(selected).filter(([, actions]) => actions.length),
    )
    const result = await authClient.organization.createRole({ role: name, permission })
    if (result.error) onError(result.error.message || 'Could not create role')
    else {
      setName('')
      setSelected({})
      await onCreated()
    }
  }
  return (
    <form className="mt-5 grid gap-4" onSubmit={submit}>
      <Field label="Role name">
        <Input
          required
          pattern="[a-z][a-z0-9-]{1,31}"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </Field>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Object.entries(platformPermissions).map(([resource, actions]) => (
          <fieldset className="rounded-md border border-zinc-800 p-3" key={resource}>
            <legend className="px-1 text-sm">{resource}</legend>
            <div className="mt-1 flex flex-wrap gap-3">
              {actions.map((action) => (
                <label className="flex items-center gap-2 text-xs text-muted" key={action}>
                  <input
                    aria-label={`${resource} ${action}`}
                    checked={selected[resource]?.includes(action) || false}
                    type="checkbox"
                    onChange={(event) => toggle(resource, action, event.target.checked)}
                  />
                  {action}
                </label>
              ))}
            </div>
          </fieldset>
        ))}
      </div>
      <Button className="w-fit" type="submit">
        Create role
      </Button>
    </form>
  )
}
