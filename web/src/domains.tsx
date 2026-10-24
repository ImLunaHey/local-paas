import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Globe, Plus, ArrowRight } from 'lucide-react'
import { api, type Service } from './api'
import { projectsQuery } from './projects'
import { Button, Field, Input, Select } from './ui'
interface Domain {
  hostname: string
  service_id: string | null
  version: number
  project: string | null
  project_id: string | null
  environment: string | null
  service: string | null
}
interface DomainList {
  items: Domain[]
  cname_target: string | null
  edge_ready: false
}
export function Domains() {
  const client = useQueryClient()
  const query = useQuery({
    queryKey: ['domains'],
    queryFn: () => api<DomainList>('/domains'),
    refetchInterval: 15000,
  })
  const [hostname, setHostname] = useState('')
  const create = useMutation({
    mutationFn: () =>
      api('/domains', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hostname }),
      }),
    onSuccess: async () => {
      setHostname('')
      await client.invalidateQueries({ queryKey: ['domains'] })
    },
  })
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">WORKSPACE NETWORKING</div>
          <h1>Domains</h1>
          <p>Register a domain once. Assign it to any project’s web service.</p>
        </div>
        <Globe size={24} className="text-accent" />
      </div>
      <section className="panel mb-6 space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2>Public edge</h2>
          <span className="chip">Pending edge setup</span>
        </div>
        <p className="text-xs leading-relaxed text-muted">
          Domain assignments are saved here. Public traffic will start routing after the VPS and
          NetBird are connected, DNS ownership is verified, and TLS is issued.
        </p>
        {query.data?.cname_target ? (
          <div className="rounded-md border border-zinc-800 bg-zinc-950 p-4">
            <span className="text-[10px] uppercase tracking-wider text-muted">CNAME target</span>
            <code className="mt-2 block break-all text-sm">{query.data.cname_target}</code>
            <p className="mt-2 text-xs text-muted">
              Point subdomains here at your DNS provider. For a root domain, use ALIAS/ANAME or
              CNAME flattening if your provider supports it. DNS configuration alone does not
              activate routing yet.
            </p>
          </div>
        ) : (
          <div className="rounded-md border border-dashed border-zinc-700 p-4 text-xs text-muted">
            No CNAME target configured yet. The shared target will appear here when the public edge
            hostname is set.
          </div>
        )}
      </section>
      <form
        className="panel mb-6 grid items-end gap-3 p-5 sm:grid-cols-[1fr_auto]"
        onSubmit={(e) => {
          e.preventDefault()
          create.mutate()
        }}
      >
        <Field label="Domain" className="min-w-0">
          <Input
            required
            aria-label="Domain"
            maxLength={253}
            placeholder="app.example.com"
            value={hostname}
            onChange={(e) => {
              setHostname(e.target.value)
              create.reset()
            }}
          />
        </Field>
        <Button
          type="submit"
          variant="primary"
          className="w-full sm:w-auto"
          disabled={create.isPending}
        >
          <Plus size={15} />
          Add domain
        </Button>
        <p className="text-xs text-muted sm:col-span-2">
          Enter a hostname such as app.example.com, without https://.
        </p>
      </form>
      {(query.error || create.error) && (
        <p role="alert" className="error-notice">
          {(query.error || create.error)?.message}
        </p>
      )}
      <div className="space-y-4">
        {query.data?.items.map((domain) => (
          <DomainAssignment key={domain.hostname + ':' + domain.version} domain={domain} />
        ))}
      </div>
      {query.isPending && <p className="text-xs text-muted">Loading domains…</p>}
      {query.data?.items.length === 0 && (
        <div className="panel p-12 text-center">
          <Globe size={24} className="mx-auto mb-4 text-muted" />
          <h2>No domains yet</h2>
          <p className="mt-2 text-xs text-muted">
            Add a domain now and choose the service it should reach.
          </p>
        </div>
      )}
    </>
  )
}
function DomainAssignment({ domain }: { domain: Domain }) {
  const client = useQueryClient()
  const [project, setProject] = useState(domain.project_id ?? '')
  const [environment, setEnvironment] = useState(domain.environment ?? '')
  const [service, setService] = useState(domain.service_id ?? '')
  const projects = useQuery(projectsQuery)
  const detail = useQuery({
    queryKey: ['projects', project],
    queryFn: () =>
      api<{ id: string; name: string; environments: { id: string; name: string }[] }>(
        '/projects/' + project,
      ),
    enabled: !!project,
  })
  const services = useQuery({
    queryKey: ['domain-services', project, environment],
    queryFn: () =>
      api<{ items: Service[]; total: number }>(
        '/services?' +
          new URLSearchParams({ project: detail.data!.name, environment, offset: '0' }),
      ),
    enabled: !!detail.data && !!environment,
  })
  const save = useMutation({
    mutationFn: () =>
      api('/domains/' + encodeURIComponent(domain.hostname), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ service_id: service || null, expected_version: domain.version }),
      }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['domains'] })
    },
  })
  return (
    <section className="panel p-5" aria-label={domain.hostname}>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="break-all">{domain.hostname}</h2>
          <p className="mt-2 text-xs text-muted">
            {domain.service_id
              ? `${domain.project} / ${domain.environment} → ${domain.service}`
              : 'Unassigned'}
          </p>
        </div>
        <span className="chip">Pending edge setup</span>
      </div>
      <form
        className="grid items-end gap-4 sm:grid-cols-2 xl:grid-cols-[1fr_1fr_1fr_auto]"
        onSubmit={(e) => {
          e.preventDefault()
          save.mutate()
        }}
      >
        <Field label="Project">
          <Select
            aria-label={'Project for ' + domain.hostname}
            value={project}
            onChange={(e) => {
              setProject(e.target.value)
              setEnvironment('')
              setService('')
            }}
          >
            <option value="">Unassigned</option>
            {projects.data?.items.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Environment">
          <Select
            aria-label={'Environment for ' + domain.hostname}
            disabled={!project || !detail.data}
            value={environment}
            onChange={(e) => {
              setEnvironment(e.target.value)
              setService('')
            }}
          >
            <option value="">Choose environment</option>
            {detail.data?.environments.map((e) => (
              <option key={e.id} value={e.name}>
                {e.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Service">
          <Select
            aria-label={'Service for ' + domain.hostname}
            disabled={!environment || !services.data}
            value={service}
            onChange={(e) => setService(e.target.value)}
          >
            <option value="">Choose service</option>
            {services.data?.items
              .filter(
                (s) =>
                  (s.spec.workload.kind === 'oci-service' &&
                    s.spec.workload.execution !== 'worker') ||
                  s.spec.workload.kind === 'celld-service',
              )
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.spec.name}
                </option>
              ))}
          </Select>
        </Field>
        <Button
          type="submit"
          disabled={
            save.isPending || (!!project && !service) || service === (domain.service_id ?? '')
          }
        >
          Save assignment
        </Button>
      </form>
      {(save.error || services.error || detail.error || projects.error) && (
        <p role="alert" className="error-notice mt-4">
          {(save.error || services.error || detail.error || projects.error)?.message}
        </p>
      )}
      {domain.service_id && (
        <Link
          className="mt-4 inline-flex items-center gap-2 text-xs text-muted hover:text-white"
          to="/services/$serviceId/networking"
          params={{ serviceId: domain.service_id }}
        >
          Service networking <ArrowRight size={12} />
        </Link>
      )}
    </section>
  )
}
