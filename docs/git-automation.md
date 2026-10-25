# Git provider automation

GitHub source connections can turn authenticated repository events into durable
build requests. The provider adapter supports public repositories and private
repositories through repository-scoped GitHub App installation credentials.

## Trust boundary

Creating a connection requires operator authorization for the active
organization. The configured repository must exactly match the service's
credential-free `https://github.com/owner/repository` source. The webhook secret
must contain 32–512 bytes. It and the optional GitHub App private key are written
to the dedicated OpenBao instance and are never returned, persisted in
PostgreSQL, or included in audit data.

PostgreSQL records the connection policy and bounded delivery metadata. It does
not retain webhook bodies, signatures, authenticated clone URLs, or provider
tokens. App and installation IDs are non-secret routing metadata; the database
stores only the opaque OpenBao path for key material. A SHA-256 body digest
detects a delivery ID reused with different input.

Configure the external authority that terminates and forwards webhook requests:

```text
GITHUB_WEBHOOK_HOST=hooks.platform.example
```

The value is an exact HTTP `Host` authority, including a port when one is used.
Without it, webhook requests remain limited to loopback development access. This
setting only permits the request authority; the operator must separately install
a verified HTTPS reverse proxy and restrict the management API as described in
the installation guide. Local development does not authorize DNS, proxy, or
firewall changes.

After upgrading an existing installation, run `make unseal` once to reconcile the
controller's OpenBao policy before creating a source connection. The command
retains the existing controller identity and secret data.

Create a connection with `POST /api/source-connections`:

```json
{
  "serviceId": "0199f5d2-4c58-7000-8000-000000000001",
  "repository": "owner/repository",
  "webhookSecret": "a separately generated high-entropy shared secret",
  "events": ["push", "tag", "pull_request"],
  "githubAppId": 12345,
  "githubInstallationId": 67890,
  "githubPrivateKey": "-----BEGIN RSA PRIVATE KEY-----\n..."
}
```

Omit all three `github*` fields for a public-only connection. For private
access, the GitHub App must be installed on this repository and grant repository
Contents read permission. The worker signs a nine-minute App JWT, asks GitHub
for a fresh installation token restricted again to this one repository and read
permission, and discards it after the build. Installation tokens are never
cached. A manual build of the connected service uses the same credential path.

Use the same secret in the GitHub webhook configuration and point its payload URL
to `/api/webhooks/github/{connectionId}`. Select JSON content and enable only the
events in the connection policy. A connection and its recent observations are
available from `GET /api/source-connections` and
`GET /api/source-connections/{connectionId}/deliveries`.

## Delivery semantics

The adapter requires GitHub's `X-Hub-Signature-256`, `X-GitHub-Delivery`, and
`X-GitHub-Event` headers. HMAC comparison is constant-time. Delivery IDs are
unique per connection and are checked transactionally; an exact retry returns the
original observation, while reuse with a different event or body digest fails.
GitHub does not sign a delivery timestamp, so freshness is not invented from an
untrusted payload timestamp. The delivery ID is the replay boundary.

Accepted pushes and tag pushes record the full `after` commit. Pull requests are
accepted only for `opened`, `reopened`, and `synchronize`, and fork pull requests
are denied by default. The delivery observation, pinned commit, build snapshot,
and build event commit in one PostgreSQL transaction. The builder receives only
the immutable commit, never the mutable branch or tag.

The configured event list is intentionally a build policy, not an implicit
production-deploy policy. Successful builds create revisions through the normal
transactional flow; traffic changes still require the existing explicit deploy
operation. Thus a duplicate delivery cannot create a duplicate build or logical
deployment.

If a service already has a queued or running build, the delivery is recorded as
`blocked`; it is not reported as accepted and no second build is fabricated.
Unsupported events, disabled policies, deleted refs, and fork pull requests are
recorded as `ignored` with a non-secret reason. GitHub `ping` verifies the
connection without starting a build.

## Revocation, rotation, and repository changes

GitHub rejects a removed or suspended installation, revoked key, missing
repository grant, or transferred repository that is no longer covered by the
installation. GitHub denial fails the build with `source_authentication_failed`;
an OpenBao or provider-connectivity outage uses
`source_authentication_unavailable`. In both cases the connection changes to
`error` and exposes a credential-free remediation message. No successful build
or revision is fabricated.

Rotate a GitHub App key from the dashboard or with
`PUT /api/source-connections/{id}/github-key` and a JSON body containing only
`githubPrivateKey`. OpenBao performs a compare-and-set replacement while
preserving the webhook secret; PostgreSQL returns to `configured` without ever
receiving key material. Keep the old GitHub key active until this request
succeeds, then revoke it at GitHub. The next successful token exchange changes
the connection to `active`.

After repository transfer, update the service repository and recreate its source
connection with the new owner plus the installation that covers it. If an
installation is removed, reinstall the App with Contents read access and rotate
the stored key if necessary. Replaying an old delivery does not test recovery:
queue a new manual build or send a new signed event so the worker mints a fresh
token.

## Current limits

- Do not put credentials in a repository URL. GitHub App authentication is the
  only private-source mechanism.
- Provider status checks and connection deletion remain follow-up work.
- Automatic production deployment is deliberately not implied by source events.
- Blocked deliveries require an operator to request a later build; they are not
  silently retried.
- Pull-request preview environment creation belongs to the separate preview
  lifecycle work and is not implied by accepting a pull-request build event.

These limits keep provider automation from bypassing the existing isolated
builder, immutable revision, secret-reference, and truthful-state boundaries.
