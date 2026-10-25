# Git provider automation

GitHub source connections can turn authenticated repository events into durable
build requests. This is an initial provider adapter over provider-neutral source
policy: it supports public, credential-free GitHub repositories. GitHub App
installation credentials and private checkout are not implemented yet.

## Trust boundary

Creating a connection requires operator authorization for the active
organization. The configured repository must exactly match the service's
credential-free `https://github.com/owner/repository` source. The webhook secret
must contain 32–512 bytes. It is written to the dedicated OpenBao instance and is
never returned, persisted in PostgreSQL, or included in audit data.

PostgreSQL records the connection policy and bounded delivery metadata. It does
not retain webhook bodies, signatures, authenticated clone URLs, or provider
tokens. A SHA-256 body digest detects a delivery ID reused with different input.

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
  "events": ["push", "tag", "pull_request"]
}
```

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

If a service already has a queued or running build, the delivery is recorded as
`blocked`; it is not reported as accepted and no second build is fabricated.
Unsupported events, disabled policies, deleted refs, and fork pull requests are
recorded as `ignored` with a non-secret reason. GitHub `ping` verifies the
connection without starting a build.

## Current limits

- Private repository access and short-lived GitHub App installation tokens are
  not implemented. Do not put credentials in a repository URL.
- Provider status checks, automatic deployment policy, key rotation, connection
  deletion, and provider revocation handling remain follow-up work.
- Blocked deliveries require an operator to request a later build; they are not
  silently retried.
- Pull-request preview environment creation belongs to the separate preview
  lifecycle work and is not implied by accepting a pull-request build event.

These limits keep provider automation from bypassing the existing isolated
builder, immutable revision, secret-reference, and truthful-state boundaries.
