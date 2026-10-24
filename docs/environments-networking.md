# Environments and private networking

Environments are project-scoped namespaces. The Environments page creates them
without copying secrets or deploying anything. The service list filters by
project/environment, and registration suggests existing environment names.
A registered service cannot change its project or environment: register a separate
service in the destination so its deployments, routing and secret identity remain
independent. Configuration and deployment histories belong to that service UUID.

Every service page has an Open app action when a URL exists, otherwise Set up URL.
Networking displays the configured container port, the active deployment's port,
and its private HTTPS endpoint. Saving a URL mapping updates routing immediately.
Changing the container port updates desired configuration; the active deployment
keeps its old port until a new deployment passes readiness.

Configure private HTTPS preview endpoints using `PREVIEW_HOST` and `PREVIEW_PORTS`.
A private TLS proxy (for example Tailscale Serve) must forward those host/port
pairs to the independent loopback ingress on port 8090. An endpoint belongs to
only one service; concurrent claims conflict. Configure forwarding before adding
ports to the API allowlist, and preserve any existing proxy routes.

These are tailnet URLs, not public custom domains. The domains field in a
specification does not yet provision DNS or the future DigitalOcean edge.
The preview proxy runs independently of the API and enforces bounded HTTP requests.

Validated with database tests for environment filtering, immovable service
identity, port updates, optimistic concurrency and rejecting unconfigured URLs.
Browser checks cover header links, Networking routes/reloads and environment
navigation/filtering against the isolated browser-test API.
