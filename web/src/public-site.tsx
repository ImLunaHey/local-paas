import { Link, useRouterState } from '@tanstack/react-router'
import {
  ArrowRight,
  Box,
  Check,
  ChevronRight,
  CircleDot,
  Clock3,
  CloudCog,
  Code2,
  Container,
  Copy,
  Database,
  FileCode2,
  GitFork,
  Globe2,
  HardDrive,
  Layers3,
  Menu,
  Search,
  Server,
  ShieldCheck,
  Sparkles,
  Terminal,
  X,
  Zap,
} from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { cn } from 'cn'

const repositoryUrl = 'https://github.com/ImLunaHey/local-paas'

const docsNavigation = [
  {
    label: 'Get started',
    items: [
      { title: 'Introduction', href: '/docs' },
      { title: 'Installation', href: '/docs/installation' },
      { title: 'Deploy an application', href: '/docs/deployments' },
    ],
  },
  {
    label: 'Platform',
    items: [
      { title: 'Architecture', href: '/docs/architecture' },
      { title: 'Builds & runtimes', href: '/docs/deployments#builds' },
      { title: 'Private networking', href: '/docs/architecture#networking' },
      { title: 'Storage', href: '/docs/architecture#storage' },
    ],
  },
  {
    label: 'Operations',
    items: [
      { title: 'Health & rollbacks', href: '/docs/deployments#health' },
      { title: 'Security model', href: '/docs/architecture#security' },
      { title: 'Hardware requirements', href: '/docs/installation#requirements' },
    ],
  },
]

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link to="/" className="lp-brand" aria-label="local paas home">
      <span className="lp-brand-mark" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      {!compact && (
        <span className="lp-brand-word">
          local<span>/</span>paas
        </span>
      )}
    </Link>
  )
}

function PublicHeader({ docs = false }: { docs?: boolean }) {
  const [menuOpen, setMenuOpen] = useState(false)
  return (
    <header className={cn('lp-header', docs && 'lp-header-docs')}>
      <div className="lp-header-inner">
        <Brand />
        <nav className="lp-nav" aria-label="Public navigation">
          <Link to="/docs" activeProps={{ 'data-active': true }}>
            Documentation
          </Link>
          <a href={`${repositoryUrl}/blob/main/docs/architecture.md`}>Architecture</a>
          <a href={repositoryUrl}>GitHub</a>
        </nav>
        <div className="lp-header-actions">
          <Link to="/app" className="lp-link-muted">
            Sign in
          </Link>
          <Link to="/docs/installation" className="lp-button lp-button-small">
            Install local/paas <ArrowRight size={13} />
          </Link>
        </div>
        <button
          className="lp-mobile-menu"
          type="button"
          aria-label={menuOpen ? 'Close navigation' : 'Open navigation'}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
        >
          {menuOpen ? <X size={19} /> : <Menu size={19} />}
        </button>
      </div>
      {menuOpen && (
        <nav className="lp-mobile-nav" aria-label="Mobile navigation">
          <Link to="/docs" onClick={() => setMenuOpen(false)}>
            Documentation
          </Link>
          <a href={`${repositoryUrl}/blob/main/docs/architecture.md`}>Architecture</a>
          <a href={repositoryUrl}>GitHub</a>
          <Link to="/app" onClick={() => setMenuOpen(false)}>
            Sign in to the control plane
          </Link>
        </nav>
      )}
    </header>
  )
}

function HeroConsole() {
  return (
    <div className="lp-console" aria-label="Illustrative deployment output">
      <div className="lp-console-topbar">
        <div className="lp-console-dots" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <span>deploy / api-production</span>
        <span className="lp-live">
          <i /> live
        </span>
      </div>
      <div className="lp-console-body">
        <div className="lp-console-command">
          <span>$</span> git push origin main
        </div>
        <div className="lp-console-line">
          <i>01</i>
          <span className="lp-dim">Source</span>
          <b>f7a21c9</b>
          <em>pinned</em>
        </div>
        <div className="lp-console-line">
          <i>02</i>
          <span className="lp-dim">Build</span>
          <b>Dockerfile</b>
          <em>18.4s</em>
        </div>
        <div className="lp-console-line">
          <i>03</i>
          <span className="lp-dim">Image</span>
          <b>sha256:34f…a91</b>
          <em>immutable</em>
        </div>
        <div className="lp-console-line">
          <i>04</i>
          <span className="lp-dim">Health</span>
          <b>2 / 2 ready</b>
          <em>passed</em>
        </div>
        <div className="lp-console-line lp-console-promoted">
          <i>05</i>
          <span>Route promoted</span>
          <b>api.example.net</b>
          <Check size={14} />
        </div>
      </div>
      <div className="lp-console-footer">
        <span>
          <CircleDot size={12} /> deployment succeeded
        </span>
        <span>
          production <ChevronRight size={12} /> revision 28
        </span>
      </div>
    </div>
  )
}

const platformFeatures = [
  {
    icon: Container,
    number: '01',
    title: 'Build from what you have',
    description:
      'Deploy a Dockerfile or let the platform generate a build recipe for Node, Bun, Python, Go, Rust, Ruby, or PHP.',
  },
  {
    icon: ShieldCheck,
    number: '02',
    title: 'Promote with proof',
    description:
      'Candidates pass readiness and stabilization before traffic moves. Failed builds leave the active revision untouched.',
  },
  {
    icon: Server,
    number: '03',
    title: 'Run on machines you know',
    description:
      'Isolated workers, durable placement, explicit capacity, and authenticated agents—visible from one control plane.',
  },
]

function MarketingHome() {
  return (
    <div className="public-site">
      <PublicHeader />
      <main className="lp-home">
        <section className="lp-hero">
          <div className="lp-grid-glow" aria-hidden="true" />
          <div className="lp-hero-copy">
            <div className="lp-kicker">
              <Sparkles size={13} /> An application platform for your own Linux
            </div>
            <h1>
              Ship software.
              <br />
              <span>Keep the keys.</span>
            </h1>
            <p>
              A self-hosted application platform with the workflow of a modern cloud—built in Rust,
              deployed to isolated VMs, and operated on infrastructure you control.
            </p>
            <div className="lp-hero-actions">
              <Link to="/docs/installation" className="lp-button">
                Start installing <ArrowRight size={15} />
              </Link>
              <a href={repositoryUrl} className="lp-button lp-button-secondary">
                <GitFork size={15} /> View on GitHub
              </a>
            </div>
            <div className="lp-hero-proof">
              <span>
                <Check size={12} /> MIT licensed
              </span>
              <span>
                <Check size={12} /> x86-64 + ARM64
              </span>
              <span>
                <Check size={12} /> No hosted control plane
              </span>
            </div>
          </div>
          <div className="lp-hero-visual">
            <div className="lp-orbit lp-orbit-one" aria-hidden="true" />
            <div className="lp-orbit lp-orbit-two" aria-hidden="true" />
            <HeroConsole />
            <div className="lp-float-card lp-float-build">
              <span className="lp-float-icon">
                <Zap size={13} />
              </span>
              <span>
                <b>Build complete</b>
                <small>18.4 seconds</small>
              </span>
            </div>
            <div className="lp-float-card lp-float-health">
              <span className="lp-pulse" />
              <span>
                <b>All systems ready</b>
                <small>2 replicas · 3 nodes</small>
              </span>
            </div>
          </div>
        </section>

        <section className="lp-runtime-strip" aria-label="Supported application runtimes">
          <span>DEPLOY YOUR STACK</span>
          <div>
            <b>Node</b>
            <i /> <b>Python</b>
            <i /> <b>Go</b>
            <i /> <b>Rust</b>
            <i /> <b>Ruby</b>
            <i /> <b>PHP</b>
            <i /> <b>Docker</b>
          </div>
        </section>

        <section className="lp-section lp-capabilities">
          <div className="lp-section-heading">
            <div>
              <span className="lp-overline">THE DEPLOYMENT PATH</span>
              <h2>
                From commit to healthy
                <br />
                without the hand-waving.
              </h2>
            </div>
            <p>
              Every phase is explicit, persisted, and observable. Success in the interface means the
              platform actually observed success.
            </p>
          </div>
          <div className="lp-feature-grid">
            {platformFeatures.map((feature) => {
              const Icon = feature.icon
              return (
                <article className="lp-feature" key={feature.number}>
                  <div className="lp-feature-top">
                    <span>{feature.number}</span>
                    <Icon size={20} />
                  </div>
                  <h3>{feature.title}</h3>
                  <p>{feature.description}</p>
                  <div className="lp-feature-rule" />
                </article>
              )
            })}
          </div>
        </section>

        <section className="lp-workflow">
          <div className="lp-workflow-copy">
            <span className="lp-overline">ONE CONTROL PLANE</span>
            <h2>
              All the pieces.
              <br />
              <em>None of the mystery.</em>
            </h2>
            <p>
              Builds run away from workloads. Secrets stay in OpenBao. Runtime logs land in
              ClickHouse. Desired state and audit events stay transactional in PostgreSQL.
            </p>
            <Link to="/docs/architecture" className="lp-text-link">
              Explore the architecture <ArrowRight size={14} />
            </Link>
          </div>
          <div className="lp-system-map">
            <div className="lp-map-label lp-map-label-top">YOUR CONTROL PLANE</div>
            <div className="lp-map-row lp-map-control">
              <div>
                <CloudCog size={18} />
                <span>Controller</span>
                <small>Rust · Axum</small>
              </div>
              <div>
                <Database size={18} />
                <span>PostgreSQL</span>
                <small>desired state</small>
              </div>
              <div>
                <ShieldCheck size={18} />
                <span>OpenBao</span>
                <small>secret delivery</small>
              </div>
            </div>
            <div className="lp-map-connectors" aria-hidden="true">
              <i />
              <i />
              <i />
            </div>
            <div className="lp-map-label">ISOLATED EXECUTION</div>
            <div className="lp-map-row lp-map-workers">
              <div>
                <Terminal size={18} />
                <span>Builder VM</span>
                <small>BuildKit</small>
              </div>
              <div>
                <Box size={18} />
                <span>Worker 01</span>
                <small>containerd</small>
              </div>
              <div>
                <Box size={18} />
                <span>Worker 02</span>
                <small>containerd</small>
              </div>
              <div>
                <Box size={18} />
                <span>Worker 03</span>
                <small>containerd</small>
              </div>
            </div>
            <p className="lp-map-note">
              Nodes can span physical hosts. Co-located workers are not presented as separate
              failure domains.
            </p>
          </div>
        </section>

        <section className="lp-bento lp-section">
          <article className="lp-bento-main">
            <div className="lp-bento-icon">
              <Globe2 size={20} />
            </div>
            <span className="lp-overline">ACKNOWLEDGED ROUTING</span>
            <h3>Traffic moves only after health is real.</h3>
            <p>
              Readiness gates private previews. Public promotion is a versioned route update,
              acknowledged at the edge before old instances drain.
            </p>
            <div className="lp-route-demo">
              <div>
                <span className="lp-route-dot" /> api.example.net
              </div>
              <ChevronRight size={14} />
              <div>
                <small>ACTIVE</small> revision 28 <b>healthy</b>
              </div>
            </div>
          </article>
          <article className="lp-bento-card">
            <Clock3 size={20} />
            <h3>Jobs and schedules</h3>
            <p>Run one-off commands or durable interval schedules against pinned revisions.</p>
          </article>
          <article className="lp-bento-card">
            <HardDrive size={20} />
            <h3>State, honestly labeled</h3>
            <p>Managed PostgreSQL, Redis, object storage, and explicitly node-pinned volumes.</p>
          </article>
        </section>

        <section className="lp-closing">
          <div className="lp-closing-noise" aria-hidden="true" />
          <span className="lp-overline">A SMALLER CLOUD, BUILT YOUR WAY</span>
          <h2>
            Deploy the platform.
            <br />
            Then deploy everything else.
          </h2>
          <p>
            Start with one Linux host, an explicit checklist, and documentation that tells you where
            the edges are.
          </p>
          <div className="lp-hero-actions">
            <Link to="/docs/installation" className="lp-button lp-button-light">
              Read the installation guide <ArrowRight size={15} />
            </Link>
            <Link to="/docs" className="lp-button lp-button-dark">
              Browse documentation
            </Link>
          </div>
        </section>
      </main>
      <PublicFooter />
    </div>
  )
}

function PublicFooter() {
  return (
    <footer className="lp-footer">
      <div>
        <Brand />
        <p>
          A self-hosted application platform for teams that want modern delivery on infrastructure
          they control.
        </p>
      </div>
      <div className="lp-footer-links">
        <div>
          <b>Product</b>
          <Link to="/docs">Documentation</Link>
          <Link to="/docs/architecture">Architecture</Link>
          <Link to="/app">Control plane</Link>
        </div>
        <div>
          <b>Project</b>
          <a href={repositoryUrl}>GitHub</a>
          <a href={`${repositoryUrl}/blob/main/LICENSE`}>MIT License</a>
          <a href={`${repositoryUrl}/blob/main/README.md`}>README</a>
        </div>
      </div>
      <div className="lp-footer-bottom">
        <span>Built for a smaller cloud.</span>
        <span>local/paas · 0.1.0</span>
      </div>
    </footer>
  )
}

type DocsPage = 'introduction' | 'installation' | 'deployments' | 'architecture'

const docsMeta: Record<DocsPage, { eyebrow: string; title: string; description: string }> = {
  introduction: {
    eyebrow: 'GET STARTED',
    title: 'Meet local/paas',
    description: 'A practical map of the platform, what it runs, and where to go next.',
  },
  installation: {
    eyebrow: 'GET STARTED',
    title: 'Install the platform',
    description:
      'Prepare a Linux host, validate it, and provision the local control plane and isolated VMs.',
  },
  deployments: {
    eyebrow: 'GUIDES',
    title: 'Deploy an application',
    description:
      'Create a service from source, produce an immutable image, and promote a healthy revision.',
  },
  architecture: {
    eyebrow: 'PLATFORM',
    title: 'Architecture',
    description: 'How the controller, builder, workers, state stores, and edge fit together.',
  },
}

function CodeBlock({ children, label = 'shell' }: { children: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    await navigator.clipboard.writeText(children)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1_500)
  }
  return (
    <div className="docs-code">
      <div>
        <span>{label}</span>
        <button type="button" onClick={() => void copy()} aria-label="Copy code">
          <Copy size={13} /> {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre>
        <code>{children}</code>
      </pre>
    </div>
  )
}

function Callout({ children, title }: { children: ReactNode; title: string }) {
  return (
    <aside className="docs-callout">
      <span>
        <ShieldCheck size={16} />
      </span>
      <div>
        <b>{title}</b>
        <p>{children}</p>
      </div>
    </aside>
  )
}

function IntroductionDocs() {
  return (
    <>
      <p className="docs-lead">
        local/paas turns a compatible Linux machine into a private application platform. You get
        source-based builds, health-gated deployments, logs, metrics, databases, storage, jobs, and
        private networking without outsourcing the control plane.
      </p>
      <h2 id="mental-model">The mental model</h2>
      <p>
        The management services run on the host. Application builds happen in a dedicated builder
        VM, and OCI workloads run through authenticated agents in isolated worker VMs.
      </p>
      <div className="docs-card-grid">
        <Link to="/docs/installation">
          <Server size={18} />
          <b>Install</b>
          <span>Prepare one Linux host and provision the platform.</span>
          <ArrowRight size={14} />
        </Link>
        <Link to="/docs/deployments">
          <Container size={18} />
          <b>Deploy</b>
          <span>Build from Git or a local upload and promote safely.</span>
          <ArrowRight size={14} />
        </Link>
        <Link to="/docs/architecture">
          <Layers3 size={18} />
          <b>Understand</b>
          <span>See the trust boundaries and runtime design.</span>
          <ArrowRight size={14} />
        </Link>
      </div>
      <h2 id="what-runs">What you can run</h2>
      <p>
        Dockerfiles are the primary contract. For straightforward repositories with committed
        lockfiles, generated recipes support Node, Bun, Python, Go, Rust, Ruby, and PHP.
      </p>
      <Callout title="Private alpha">
        This release is designed for trusted operators on a private network. It is not a public
        multi-tenant PaaS.
      </Callout>
      <h2 id="next">Choose your next step</h2>
      <p>
        New operators should start with installation requirements. If the platform is already
        running, move directly to the deployment guide.
      </p>
    </>
  )
}

function InstallationDocs() {
  return (
    <>
      <p className="docs-lead">
        The default topology provisions one builder VM, three worker VMs, and management services on
        the Linux host. Installation is explicit and runs only after a read-only qualification
        check.
      </p>
      <h2 id="requirements">Host requirements</h2>
      <div className="docs-spec-table">
        <div>
          <span>CPU</span>
          <b>x86-64 or ARM64 with KVM</b>
        </div>
        <div>
          <span>Memory</span>
          <b>16 GiB available minimum</b>
        </div>
        <div>
          <span>Storage</span>
          <b>100 GiB free SSD / NVMe</b>
        </div>
        <div>
          <span>Operating system</span>
          <b>Linux · systemd · cgroup v2</b>
        </div>
      </div>
      <Callout title="One physical failure domain">
        The three default workers are separate scheduling nodes, but when they share a host they
        also share its power, storage, and network failure domain.
      </Callout>
      <h2 id="prepare">Prepare the checkout</h2>
      <p>
        Install Nix first, then enter the pinned development environment and create your local
        configuration.
      </p>
      <CodeBlock>{`nix develop\ninstall -d -m 700 .local\ncp platform.example.json .local/platform.json`}</CodeBlock>
      <h2 id="validate">Validate before provisioning</h2>
      <p>
        The setup check is read-only. Review every reported requirement before allowing installation
        to make host-level changes.
      </p>
      <CodeBlock>{`make setup-check\nmake setup-install`}</CodeBlock>
      <p>
        After installation, open <code>http://localhost:5188</code> locally or use the documented
        private HTTPS access from another trusted machine.
      </p>
      <h2 id="development">Development without VMs</h2>
      <p>
        You can work on the control plane and web interface without provisioning infrastructure.
        Unavailable services remain unavailable; development mode does not fabricate healthy
        resources.
      </p>
      <CodeBlock>{`pnpm install --frozen-lockfile\nmake db\nmake bootstrap-auth\nmake api\nmake web`}</CodeBlock>
    </>
  )
}

function DeploymentDocs() {
  return (
    <>
      <p className="docs-lead">
        A deployment resolves source to a pinned commit, produces an immutable OCI image, starts a
        candidate, and waits for real readiness before it changes traffic.
      </p>
      <h2 id="source">1. Connect source</h2>
      <p>
        Create a project and environment, then add an application. Choose a Git branch, tag, commit,
        or upload local source. Mutable Git references are resolved once before the build begins.
      </p>
      <h2 id="builds">2. Configure the build</h2>
      <p>
        Use a Dockerfile for full control. For a supported single-application repository, local/paas
        can record detection evidence and generate a versioned build recipe.
      </p>
      <div className="docs-inline-code">
        <FileCode2 size={18} />
        <div>
          <b>Dockerfile-first</b>
          <span>Explicit context, target, arguments, port, and health checks.</span>
        </div>
      </div>
      <h2 id="health">3. Define health</h2>
      <p>
        Set the application port and an explicit readiness check. The platform will not infer a safe
        probe from <code>EXPOSE</code>.
      </p>
      <CodeBlock label="platform.json">{`{\n  "port": 3000,\n  "readiness": {\n    "path": "/health",\n    "intervalSeconds": 5\n  }\n}`}</CodeBlock>
      <h2 id="promote">4. Deploy and observe</h2>
      <p>
        The candidate moves through queued, building, preparing, stabilizing, promoting, and
        draining. Before promotion, failure leaves the active route untouched. After promotion,
        rollback restores and acknowledges the prior healthy route before stopping candidates.
      </p>
      <Callout title="No optimistic success">
        A registered commit is not a built image, and a started container is not a healthy
        deployment. The interface reports observed state at each boundary.
      </Callout>
    </>
  )
}

function ArchitectureDocs() {
  return (
    <>
      <p className="docs-lead">
        local/paas separates management, builds, workload execution, secret storage, and public
        routing. Provider-specific details remain behind internal interfaces.
      </p>
      <h2 id="components">Core components</h2>
      <div className="docs-architecture-list">
        <div>
          <span>01</span>
          <div>
            <b>Rust control plane</b>
            <p>
              Persists desired state, reconciles work, schedules placement, and serves the operator
              API.
            </p>
          </div>
        </div>
        <div>
          <span>02</span>
          <div>
            <b>Isolated builder</b>
            <p>BuildKit produces immutable image digests away from the host and worker runtimes.</p>
          </div>
        </div>
        <div>
          <span>03</span>
          <div>
            <b>Authenticated node agents</b>
            <p>
              Workers reconcile assigned generations through a runtime-independent internal
              contract.
            </p>
          </div>
        </div>
        <div>
          <span>04</span>
          <div>
            <b>Independent edge worker</b>
            <p>
              Caddy route changes, TLS observations, and promotion acknowledgements remain separate
              from private routing.
            </p>
          </div>
        </div>
      </div>
      <h2 id="networking">Networking</h2>
      <p>
        Workloads get isolated network namespaces and declared public ports. Private connections are
        explicit service references. Public ingress uses versioned desired and observed routes with
        leased targets.
      </p>
      <h2 id="storage">State and storage</h2>
      <p>
        PostgreSQL stores desired state and audit history. ClickHouse retains runtime logs. OpenBao
        holds workload secrets. Persistent local volumes are node-pinned and do not imply cross-node
        availability.
      </p>
      <h2 id="security">Security boundaries</h2>
      <p>
        Builds and workloads do not receive broad management-network access, host filesystems, raw
        runtime sockets, or database credentials. Secret values are delivered through authenticated
        agents and are never part of ordinary configuration records.
      </p>
      <Callout title="Runtime boundaries matter">
        OCI services and dedicated celld application fleets are separate execution models. Generic
        container lifecycle operations do not substitute for fleet ownership handoff.
      </Callout>
    </>
  )
}

function DocsBody({ page }: { page: DocsPage }) {
  if (page === 'installation') return <InstallationDocs />
  if (page === 'deployments') return <DeploymentDocs />
  if (page === 'architecture') return <ArchitectureDocs />
  return <IntroductionDocs />
}

const tableOfContents: Record<DocsPage, { label: string; href: string }[]> = {
  introduction: [
    { label: 'The mental model', href: '#mental-model' },
    { label: 'What you can run', href: '#what-runs' },
    { label: 'Next step', href: '#next' },
  ],
  installation: [
    { label: 'Host requirements', href: '#requirements' },
    { label: 'Prepare', href: '#prepare' },
    { label: 'Validate', href: '#validate' },
    { label: 'Development', href: '#development' },
  ],
  deployments: [
    { label: 'Connect source', href: '#source' },
    { label: 'Configure build', href: '#builds' },
    { label: 'Define health', href: '#health' },
    { label: 'Deploy', href: '#promote' },
  ],
  architecture: [
    { label: 'Core components', href: '#components' },
    { label: 'Networking', href: '#networking' },
    { label: 'State and storage', href: '#storage' },
    { label: 'Security', href: '#security' },
  ],
}

export function DocsSite({ page }: { page: DocsPage }) {
  const path = useRouterState({ select: (state) => state.location.pathname })
  const [query, setQuery] = useState('')
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const meta = docsMeta[page]
  const results = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    if (!normalizedQuery) return []
    return docsNavigation
      .flatMap((group) => group.items)
      .filter((item) => item.title.toLowerCase().includes(normalizedQuery))
  }, [query])

  useEffect(() => {
    setMobileNavOpen(false)
    setQuery('')
  }, [path])

  return (
    <div className="public-site docs-site">
      <PublicHeader docs />
      <div className="docs-search-row">
        <button
          className="docs-nav-toggle"
          type="button"
          onClick={() => setMobileNavOpen((open) => !open)}
          aria-expanded={mobileNavOpen}
        >
          <Menu size={16} /> Menu
        </button>
        <div className="docs-search">
          <Search size={15} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search documentation…"
            aria-label="Search documentation"
          />
          <kbd>⌘ K</kbd>
          {query && (
            <div className="docs-search-results">
              {results.length ? (
                results.map((result) => (
                  <a key={result.href} href={result.href}>
                    {result.title}
                    <ArrowRight size={13} />
                  </a>
                ))
              ) : (
                <span>No matching guides</span>
              )}
            </div>
          )}
        </div>
        <a className="docs-github" href={repositoryUrl}>
          <GitFork size={15} /> GitHub
        </a>
      </div>
      <div className="docs-layout">
        <aside className={cn('docs-sidebar', mobileNavOpen && 'docs-sidebar-open')}>
          <div className="docs-version">
            <span>v0.1</span>
            <b>Development alpha</b>
          </div>
          <nav aria-label="Documentation navigation">
            {docsNavigation.map((group) => (
              <div key={group.label}>
                <span>{group.label}</span>
                {group.items.map((item) => (
                  <a
                    key={item.href}
                    href={item.href}
                    data-active={
                      item.href === path || (item.href === '/docs' && path === '/docs')
                        ? true
                        : undefined
                    }
                  >
                    {item.title}
                  </a>
                ))}
              </div>
            ))}
          </nav>
          <div className="docs-sidebar-bottom">
            <Code2 size={15} />
            <span>
              Open source
              <br />
              <a href={repositoryUrl}>Read the code</a>
            </span>
          </div>
        </aside>
        <main className="docs-main">
          <article className="docs-article">
            <div className="docs-breadcrumbs">
              <Link to="/docs">Docs</Link>
              <ChevronRight size={12} />
              <span>{meta.eyebrow}</span>
            </div>
            <div className="docs-title">
              <span>{meta.eyebrow}</span>
              <h1>{meta.title}</h1>
              <p>{meta.description}</p>
            </div>
            <DocsBody page={page} />
            <div className="docs-edit">
              <span>Was this page useful?</span>
              <span>
                <button type="button" aria-label="This page was useful">
                  Yes
                </button>
                <button type="button" aria-label="This page was not useful">
                  No
                </button>
              </span>
              <a href={`${repositoryUrl}/tree/main/docs`}>
                Edit on GitHub <ArrowRight size={12} />
              </a>
            </div>
          </article>
          <aside className="docs-toc">
            <span>ON THIS PAGE</span>
            {tableOfContents[page].map((item) => (
              <a href={item.href} key={item.href}>
                {item.label}
              </a>
            ))}
          </aside>
        </main>
      </div>
    </div>
  )
}

export { MarketingHome }
