import type { DomainObservation as Domain } from '../../generated/model/domainObservation'

const messages: Record<string, string> = {
  unassigned: 'Assign a web service to start public routing.',
  'waiting-deployment': 'Deploy a ready OCI web service to start public routing.',
  'pending-edge': 'Waiting for the edge to verify DNS, issue TLS, and acknowledge this route.',
  ownership_pending:
    'Add the TXT record below at your DNS provider. Keep it in place for future verification.',
  dns_pending:
    'Point the domain’s DNS records at the configured edge. All A and AAAA answers must reach that edge.',
  tls_pending:
    'TLS is not ready. Check certificate issuance, DNS propagation, and access to the edge on ports 80 and 443.',
  route_unhealthy:
    'The edge cannot reach a healthy instance of the requested deployment. The previous route is retained when it remains healthy.',
  edge_unavailable:
    'The edge management connection is unavailable. Check the edge worker, private connection, and client certificate.',
  edge_configuration:
    'The edge rejected its configuration. Ask the platform operator to check the Caddy API and gateway certificate paths.',
  edge_conflict:
    'The edge configuration changed concurrently. The worker will retry without overwriting unrelated routes.',
  'lease-expired':
    'The edge acknowledgement expired. Public availability is no longer confirmed; stale upstream routes stop forwarding.',
  'certificate-expired': 'The observed certificate expired. Check certificate renewal at the edge.',
  'certificate-expiring':
    'The certificate expires within seven days. Check renewal before it expires.',
  active: 'DNS, TLS, and this route generation were verified through the edge.',
  removing:
    'Waiting for the edge to acknowledge route removal. Existing instances remain protected until their route leases expire.',
  removed: 'The edge acknowledged route removal.',
}

export function EdgeStatus({ domain }: { domain: Domain }) {
  return (
    <div className="mb-5 space-y-3 text-xs">
      <p className="leading-relaxed text-muted" role={domain.errorCode ? 'status' : undefined}>
        {messages[domain.status] ?? 'Waiting for an edge observation.'}
      </p>
      <div className="rounded-md border border-zinc-800 bg-zinc-950 p-4">
        <p className="mb-2 text-muted">DNS ownership · TXT record</p>
        <code className="block break-all">{domain.ownershipRecord.name}</code>
        <code className="mt-2 block break-all text-muted">{domain.ownershipRecord.value}</code>
      </div>
      <dl className="grid gap-3 sm:grid-cols-3">
        <div>
          <dt className="text-muted">Route acknowledgement</dt>
          <dd className="mt-1">
            {domain.acknowledgedGeneration ?? 'None'} / {domain.generation}
          </dd>
        </div>
        <div>
          <dt className="text-muted">Lease expires</dt>
          <dd className="mt-1">
            {domain.leaseExpiresAt
              ? new Date(domain.leaseExpiresAt).toLocaleString()
              : 'Not observed'}
          </dd>
        </div>
        <div>
          <dt className="text-muted">Certificate expires</dt>
          <dd className="mt-1">
            {domain.certificateExpiresAt
              ? new Date(domain.certificateExpiresAt).toLocaleString()
              : 'Not observed'}
          </dd>
        </div>
      </dl>
    </div>
  )
}
