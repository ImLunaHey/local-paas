import { Link, useRouterState } from '@tanstack/react-router'
import {
  ArrowRight,
  Box,
  Check,
  ChevronRight,
  CircleDot,
  CloudCog,
  Code2,
  Container,
  Copy,
  Database,
  FileCode2,
  GitFork,
  Layers3,
  Menu,
  Search,
  Server,
  ShieldCheck,
  Sparkles,
  Terminal,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { cn } from 'cn'

const repositoryUrl = 'https://github.com/ImLunaHey/local-paas'
const serif = "font-[Georgia,'Times_New_Roman',serif]"
const overline = 'font-mono text-[10px] font-semibold tracking-[.12em] text-[#ff985f] uppercase'
const button =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-[7px] border border-[#f07b3e] bg-[#f07b3e] px-[18px] text-xs font-semibold text-[#1a0d07] shadow-[inset_0_1px_0_#ffffff30,0_8px_28px_#f07b3e18] hover:-translate-y-px hover:bg-[#ff985f]'

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

function Brand() {
  return (
    <Link
      to="/"
      className="inline-flex w-max items-center gap-[11px] text-[#f3f0e8]"
      aria-label="local paas home"
    >
      <span
        className="grid size-[29px] content-center gap-[3px] rounded-[7px] border border-[#3a382f] bg-[linear-gradient(145deg,#20201c,#10100e)] p-1.5 shadow-[inset_0_1px_0_#ffffff0a]"
        aria-hidden="true"
      >
        <span className="h-0.5 rounded-full bg-[#e8e1d2]" />
        <span className="h-0.5 w-[72%] rounded-full bg-[#f07b3e]" />
        <span className="h-0.5 rounded-full bg-[#e8e1d2]" />
      </span>
      <span className="text-[15px] font-semibold tracking-[-.045em]">
        local<span className="mx-[3px] font-normal text-[#65635b]">/</span>paas
      </span>
    </Link>
  )
}

function PublicHeader({ docs = false }: { docs?: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <header
      className={cn(
        'z-50 border-b border-[#20201c] bg-[#090907e8] backdrop-blur-lg',
        docs && 'sticky top-0',
      )}
    >
      <div className="mx-auto grid min-h-[68px] w-[min(1180px,calc(100%-48px))] grid-cols-[1fr_auto_1fr] items-center gap-8 max-[980px]:grid-cols-[1fr_auto] max-[720px]:min-h-[62px] max-[720px]:w-[calc(100%-32px)]">
        <Brand />
        <nav className="flex gap-[31px] max-[980px]:hidden" aria-label="Public navigation">
          <Link className="text-xs text-[#9d9a8f] hover:text-[#f3f0e8]" to="/docs">
            Documentation
          </Link>
          <Link className="text-xs text-[#9d9a8f] hover:text-[#f3f0e8]" to="/docs/architecture">
            Architecture
          </Link>
          <a className="text-xs text-[#9d9a8f] hover:text-[#f3f0e8]" href={repositoryUrl}>
            GitHub
          </a>
        </nav>
        <div className="flex items-center justify-self-end gap-[22px] max-[720px]:hidden">
          <Link className="text-xs text-[#9d9a8f]" to="/app">
            Sign in
          </Link>
          <Link className={cn(button, 'min-h-9 px-3.5 text-[11px]')} to="/docs/installation">
            Install local/paas <ArrowRight size={13} />
          </Link>
        </div>
        <button
          className="hidden size-[38px] place-items-center justify-self-end rounded-md border border-[#302f29] bg-[#141411] text-[#c4c0b5] max-[720px]:grid"
          type="button"
          aria-label={open ? 'Close navigation' : 'Open navigation'}
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? <X size={19} /> : <Menu size={19} />}
        </button>
      </div>
      {open && (
        <nav
          className="hidden border-t border-[#20201c] bg-[#0e0e0c] px-4 py-3 max-[720px]:grid"
          aria-label="Mobile navigation"
        >
          <Link className="border-b border-[#23221e] p-3 text-xs text-[#b1ada3]" to="/docs">
            Documentation
          </Link>
          <Link
            className="border-b border-[#23221e] p-3 text-xs text-[#b1ada3]"
            to="/docs/architecture"
          >
            Architecture
          </Link>
          <a className="border-b border-[#23221e] p-3 text-xs text-[#b1ada3]" href={repositoryUrl}>
            GitHub
          </a>
          <Link className="p-3 text-xs text-[#b1ada3]" to="/app">
            Sign in to the control plane
          </Link>
        </nav>
      )}
    </header>
  )
}

function HeroConsole() {
  const rows = [
    ['01', 'Source', 'f7a21c9', 'pinned'],
    ['02', 'Build', 'Dockerfile', '18.4s'],
    ['03', 'Image', 'sha256:34f…a91', 'immutable'],
    ['04', 'Health', '2 / 2 ready', 'passed'],
  ]
  return (
    <div
      className="relative z-[2] w-[min(510px,calc(100%-42px))] overflow-hidden rounded-xl border border-[#3b3930] bg-[#0d0d0b] shadow-[0_45px_100px_#000a,inset_0_1px_0_#ffffff09] [transform:perspective(1100px)_rotateY(-4deg)] max-[720px]:w-[calc(100%-32px)] max-[720px]:transform-none"
      aria-label="Illustrative deployment output"
    >
      <div className="flex min-h-11 items-center border-b border-[#25241f] bg-[#141411] px-[15px] font-mono text-[10px] text-[#77746a]">
        <span className="mr-[22px] flex gap-[5px]">
          <i className="size-[7px] rounded-full bg-[#a4502d]" />
          <i className="size-[7px] rounded-full bg-[#34332c]" />
          <i className="size-[7px] rounded-full bg-[#34332c]" />
        </span>
        deploy / api-production
        <span className="ml-auto flex items-center gap-1.5 text-[#8eb597]">
          <i className="size-[5px] rounded-full bg-[#72a77e]" />
          live
        </span>
      </div>
      <div className="px-[17px] py-[18px]">
        <div className="mb-[18px] rounded-[5px] border border-[#24231e] bg-[#11110f] px-[13px] py-3 font-mono text-[11px] text-[#cbc6ba]">
          <span className="mr-2 text-[#f07b3e]">$</span>git push origin main
        </div>
        {rows.map(([number, label, value, state]) => (
          <div
            key={number}
            className="grid min-h-[41px] grid-cols-[28px_64px_minmax(0,1fr)_auto] items-center gap-2 border-b border-[#1d1d19] font-mono text-[10px] text-[#bcb8ad] max-[720px]:grid-cols-[22px_50px_minmax(0,1fr)_auto] max-[720px]:text-[8px]"
          >
            <i className="not-italic text-[#4c4b44]">{number}</i>
            <span className="text-[#5f5d56]">{label}</span>
            <b className="truncate font-medium">{value}</b>
            <em className="not-italic text-[#7ba886]">{state}</em>
          </div>
        ))}
        <div className="mt-2.5 grid min-h-[41px] grid-cols-[28px_1fr_auto_15px] items-center gap-2 rounded-[5px] border border-[#4d3022] bg-[#21140e] px-[11px] font-mono text-[10px] text-[#e4b095] max-[720px]:text-[8px]">
          <i className="not-italic text-[#4c4b44]">05</i>
          <span>Route promoted</span>
          <b className="font-medium text-[#9b8d82]">api.example.net</b>
          <Check size={14} />
        </div>
      </div>
      <div className="flex min-h-[42px] items-center justify-between border-t border-[#25241f] bg-[#121210] px-[17px] font-mono text-[10px] text-[#77746a] max-[720px]:text-[8px]">
        <span className="flex items-center gap-1.5 text-[#82ae8b]">
          <CircleDot size={12} /> deployment succeeded
        </span>
        <span>production · revision 28</span>
      </div>
    </div>
  )
}

const features = [
  [
    Container,
    '01',
    'Build from what you have',
    'Deploy a Dockerfile or generate a recorded build recipe for Node, Bun, Python, Go, Rust, Ruby, or PHP.',
  ],
  [
    ShieldCheck,
    '02',
    'Promote with proof',
    'Candidates pass readiness and stabilization before traffic moves. Failed builds leave the active revision untouched.',
  ],
  [
    Server,
    '03',
    'Run on machines you know',
    'Isolated workers, durable placement, explicit capacity, and authenticated agents—visible from one control plane.',
  ],
] as const

export function MarketingHome() {
  return (
    <div className="min-h-screen overflow-hidden bg-[#090907] font-sans text-[#f3f0e8] [color-scheme:dark]">
      <PublicHeader />
      <main className="w-full max-w-none p-0">
        <section className="relative mx-auto grid min-h-[676px] w-[min(1180px,calc(100%-48px))] grid-cols-[minmax(0,.92fr)_minmax(500px,1.08fr)] items-center gap-12 border-x border-[#20201c] max-[980px]:grid-cols-1 max-[980px]:py-[94px] max-[720px]:w-full max-[720px]:gap-0 max-[720px]:border-0 max-[720px]:pt-[70px]">
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(#23231e55_1px,transparent_1px),linear-gradient(90deg,#23231e55_1px,transparent_1px)] bg-[size:52px_52px] opacity-45 [mask-image:linear-gradient(to_right,transparent,black_12%,transparent_64%)]" />
          <div className="relative z-[2] pl-[57px] max-[980px]:px-[52px] max-[720px]:px-6">
            <div className="mb-6 flex w-max items-center gap-2 rounded-full border border-[#58301e] bg-[#24150e] px-2.5 py-[7px] font-mono text-[10px] font-semibold text-[#ff985f]">
              <Sparkles size={13} /> An application platform for your own Linux
            </div>
            <h1
              className={cn(
                serif,
                'text-[clamp(54px,6.2vw,82px)] leading-[.94] font-normal tracking-[-.065em] text-[#e8e1d2] max-[720px]:text-[clamp(51px,15vw,72px)]',
              )}
            >
              Ship software.
              <br />
              <span className="text-[#f07b3e] italic">Keep the keys.</span>
            </h1>
            <p className="mt-[27px] max-w-[525px] text-[15px] leading-[1.75] text-[#9d9a8f]">
              A self-hosted application platform with the workflow of a modern cloud—built in Rust,
              deployed to isolated VMs, and operated on infrastructure you control.
            </p>
            <div className="mt-[30px] flex flex-wrap gap-2.5 max-[720px]:flex-col">
              <Link className={button} to="/docs/installation">
                Start installing <ArrowRight size={15} />
              </Link>
              <a
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[7px] border border-[#36352e] bg-[#151512] px-[18px] text-xs font-semibold text-[#f3f0e8] hover:bg-[#1a1a16]"
                href={repositoryUrl}
              >
                <GitFork size={15} /> View on GitHub
              </a>
            </div>
            <div className="mt-[25px] flex flex-wrap gap-x-[19px] gap-y-2.5 text-[10px] text-[#65635b]">
              {['MIT licensed', 'x86-64 + ARM64', 'No hosted control plane'].map((label) => (
                <span className="flex items-center gap-[5px]" key={label}>
                  <Check size={12} className="text-[#71a87c]" />
                  {label}
                </span>
              ))}
            </div>
          </div>
          <div className="relative grid h-full min-h-[530px] place-items-center overflow-hidden border-l border-[#20201c] bg-[radial-gradient(circle_at_48%_46%,#50241630_0,transparent_52%)] max-[980px]:mt-12 max-[980px]:border-t max-[980px]:border-l-0">
            <div className="absolute size-[530px] rounded-full border border-[#292720]" />
            <div className="absolute size-[750px] rounded-full border border-[#1f1f1b]" />
            <HeroConsole />
          </div>
        </section>
        <section className="flex min-h-[89px] items-center justify-center gap-[70px] border-y border-[#20201c] bg-[#0c0c0a] max-[720px]:flex-col max-[720px]:items-start max-[720px]:gap-[18px] max-[720px]:px-6 max-[720px]:py-[25px]">
          <span className="font-mono text-[9px] font-semibold tracking-[.13em] text-[#57554e]">
            DEPLOY YOUR STACK
          </span>
          <div className="flex flex-wrap gap-[21px] font-mono text-xs text-[#8e8b82]">
            Node · Python · Go · Rust · Ruby · PHP · Docker
          </div>
        </section>
        <section className="mx-auto w-[min(1066px,calc(100%-48px))] py-[118px] max-[720px]:w-[calc(100%-40px)] max-[720px]:py-[84px]">
          <div className="mb-[68px] grid grid-cols-[1.2fr_.8fr] items-end gap-20 max-[980px]:grid-cols-1 max-[980px]:gap-6">
            <div>
              <span className={overline}>THE DEPLOYMENT PATH</span>
              <h2
                className={cn(
                  serif,
                  'mt-4 text-[clamp(39px,5vw,58px)] leading-[1.04] font-normal tracking-[-.052em] text-[#e8e1d2]',
                )}
              >
                From commit to healthy
                <br />
                without the hand-waving.
              </h2>
            </div>
            <p className="text-[13px] leading-[1.8] text-[#9d9a8f]">
              Every phase is explicit, persisted, and observable. Success in the interface means the
              platform actually observed success.
            </p>
          </div>
          <div className="grid grid-cols-3 border-y border-[#292923] max-[720px]:grid-cols-1">
            {features.map(([Icon, number, title, description]) => (
              <article
                className="relative min-h-[300px] border-r border-[#292923] p-[31px] last:border-r-0 max-[720px]:min-h-[245px] max-[720px]:border-r-0 max-[720px]:border-b"
                key={number}
              >
                <div className="flex justify-between">
                  <span className="font-mono text-[10px] text-[#535149]">{number}</span>
                  <Icon size={20} className="text-[#f07b3e]" />
                </div>
                <h3 className="mt-[60px] mb-3 text-[15px] font-medium text-[#ddd8cc]">{title}</h3>
                <p className="text-xs leading-[1.75] text-[#9d9a8f]">{description}</p>
                <div className="absolute right-[31px] bottom-[31px] left-[31px] h-px bg-[linear-gradient(90deg,#f07b3e,#302f29_18%,#302f29)]" />
              </article>
            ))}
          </div>
        </section>
        <ArchitectureSection />
        <section className="relative flex min-h-[585px] flex-col items-center justify-center overflow-hidden bg-[#e8e1d2] px-6 py-20 text-center text-[#171510]">
          <span className={cn(overline, 'text-[#a14824]')}>A SMALLER CLOUD, BUILT YOUR WAY</span>
          <h2
            className={cn(
              serif,
              'mt-4 text-[clamp(45px,6vw,72px)] leading-[1.04] font-normal tracking-[-.052em]',
            )}
          >
            Deploy the platform.
            <br />
            Then deploy everything else.
          </h2>
          <p className="mt-6 max-w-[530px] text-[13px] leading-[1.7] text-[#696256]">
            Start with one Linux host, an explicit checklist, and documentation that tells you where
            the edges are.
          </p>
          <div className="mt-[30px] flex flex-wrap gap-2.5">
            <Link
              className="inline-flex min-h-11 items-center gap-2 rounded-[7px] bg-[#171510] px-[18px] text-xs font-semibold text-[#f4efe5]"
              to="/docs/installation"
            >
              Read the installation guide <ArrowRight size={15} />
            </Link>
            <Link
              className="inline-flex min-h-11 items-center rounded-[7px] border border-[#bcb2a2] px-[18px] text-xs font-semibold"
              to="/docs"
            >
              Browse documentation
            </Link>
          </div>
        </section>
      </main>
      <PublicFooter />
    </div>
  )
}

function ArchitectureSection() {
  const control = [
    [CloudCog, 'Controller', 'Rust · Axum'],
    [Database, 'PostgreSQL', 'desired state'],
    [ShieldCheck, 'OpenBao', 'secret delivery'],
    [Terminal, 'Builder VM', 'BuildKit'],
    [Box, 'Worker 01', 'containerd'],
    [Box, 'Worker 02', 'containerd'],
  ] as const
  return (
    <section className="grid min-h-[680px] grid-cols-[.76fr_1.24fr] items-center gap-[86px] border-y border-[#20201c] bg-[#0d0d0b] px-[max(48px,calc((100vw-1066px)/2))] py-[110px] max-[980px]:grid-cols-1 max-[720px]:px-5 max-[720px]:py-[84px]">
      <div>
        <span className={overline}>ONE CONTROL PLANE</span>
        <h2
          className={cn(
            serif,
            'mt-4 text-[clamp(39px,5vw,58px)] leading-[1.04] font-normal tracking-[-.052em] text-[#e8e1d2]',
          )}
        >
          All the pieces.
          <br />
          <em className="text-[#f07b3e]">None of the mystery.</em>
        </h2>
        <p className="mt-[27px] max-w-[400px] text-[13px] leading-[1.8] text-[#9d9a8f]">
          Builds run away from workloads. Secrets stay in OpenBao. Runtime logs land in ClickHouse.
          Desired state and audit events stay transactional in PostgreSQL.
        </p>
        <Link
          className="mt-7 inline-flex items-center gap-2 text-xs font-semibold text-[#e8e1d2]"
          to="/docs/architecture"
        >
          Explore the architecture <ArrowRight size={14} />
        </Link>
      </div>
      <div className="rounded-xl border border-[#33322c] bg-[#11110f] p-6">
        <span className="mb-3 block font-mono text-[8px] tracking-[.13em] text-[#5e5c55]">
          PLATFORM COMPONENTS
        </span>
        <div className="grid grid-cols-3 gap-[9px] max-[720px]:grid-cols-2">
          {control.map(([Icon, title, detail]) => (
            <div
              className="grid gap-[7px] rounded-md border border-[#2b2a25] bg-[#161613] p-[15px]"
              key={title}
            >
              <Icon size={18} className="mb-2 text-[#f07b3e]" />
              <span className="text-[10px] font-semibold text-[#cfcbc0]">{title}</span>
              <small className="font-mono text-[8px] text-[#65635c]">{detail}</small>
            </div>
          ))}
        </div>
        <p className="mt-5 font-mono text-[9px] text-[#5e5c55]">
          Co-located workers are not separate physical failure domains.
        </p>
      </div>
    </section>
  )
}

function PublicFooter() {
  return (
    <footer className="m-0 flex border-0 bg-[#090907] px-[max(48px,calc((100vw-1066px)/2))] pt-[65px] pb-[25px] text-[11px] text-[#9d9a8f] max-[720px]:flex-col max-[720px]:gap-10 max-[720px]:px-6">
      <div className="w-2/5 max-[720px]:w-full">
        <Brand />
        <p className="mt-4 max-w-[310px] leading-[1.7] text-[#6e6b62]">
          A self-hosted application platform for teams that want modern delivery on infrastructure
          they control.
        </p>
      </div>
      <div className="flex flex-1 justify-end gap-20 max-[720px]:justify-start">
        <div className="grid gap-2">
          <b>Product</b>
          <Link to="/docs">Documentation</Link>
          <Link to="/docs/architecture">Architecture</Link>
          <Link to="/app">Control plane</Link>
        </div>
        <div className="grid gap-2">
          <b>Project</b>
          <a href={repositoryUrl}>GitHub</a>
          <a href={`${repositoryUrl}/blob/main/LICENSE`}>MIT License</a>
        </div>
      </div>
    </footer>
  )
}

type DocsPage = 'introduction' | 'installation' | 'deployments' | 'architecture'
const docsMeta = {
  introduction: [
    'GET STARTED',
    'Meet local/paas',
    'A practical map of the platform, what it runs, and where to go next.',
  ],
  installation: [
    'GET STARTED',
    'Install the platform',
    'Prepare a Linux host, validate it, and provision the local control plane and isolated VMs.',
  ],
  deployments: [
    'GUIDES',
    'Deploy an application',
    'Create a service from source, produce an immutable image, and promote a healthy revision.',
  ],
  architecture: [
    'PLATFORM',
    'Architecture',
    'How the controller, builder, workers, state stores, and edge fit together.',
  ],
} satisfies Record<DocsPage, [string, string, string]>
const paragraph = 'text-[13px] leading-[1.85] text-[#98958c]'
const heading =
  'mt-[58px] mb-4 scroll-mt-[155px] text-[21px] font-medium tracking-[-.025em] text-[#e1ddd2]'

function CodeBlock({ children }: { children: string }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    await navigator.clipboard.writeText(children)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1_500)
  }
  return (
    <div className="my-[27px] overflow-hidden rounded-lg border border-[#302f29] bg-[#0c0c0a]">
      <div className="flex h-9 items-center justify-between border-b border-[#25241f] bg-[#131310] px-3 font-mono text-[9px] text-[#5d5b54]">
        <span>shell</span>
        <button
          type="button"
          className="flex items-center gap-1 bg-transparent text-[#8b887f]"
          onClick={() => void copy()}
        >
          <Copy size={13} />
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="m-0 overflow-x-auto p-[21px] font-mono text-[11px] leading-[1.85] text-[#c6c1b6]">
        <code>{children}</code>
      </pre>
    </div>
  )
}

function Callout({ children, title }: { children: ReactNode; title: string }) {
  return (
    <aside className="my-[34px] flex gap-3.5 rounded-[7px] border border-[#4b3022] bg-[#18110e] px-[21px] py-[19px]">
      <ShieldCheck size={16} className="text-[#f07b3e]" />
      <div>
        <b className="text-[10px] text-[#d7c8bc]">{title}</b>
        <p className="mt-1 text-[11px] leading-[1.65] text-[#9e887c]">{children}</p>
      </div>
    </aside>
  )
}

function IntroductionDocs() {
  return (
    <>
      <p className={cn(serif, 'mb-[47px] text-[19px] leading-[1.68] text-[#c1bdb2]')}>
        local/paas turns a compatible Linux machine into a private application platform. You get
        source-based builds, health-gated deployments, logs, metrics, databases, storage, jobs, and
        private networking without outsourcing the control plane.
      </p>
      <h2 id="mental-model" className={heading}>
        The mental model
      </h2>
      <p className={paragraph}>
        Management services run on the host. Builds happen in a dedicated builder VM, while OCI
        workloads run through authenticated agents in isolated worker VMs.
      </p>
      <div className="my-8 grid grid-cols-3 gap-2.5 max-[720px]:grid-cols-1">
        <DocCard Icon={Server} title="Install" href="/docs/installation">
          Prepare one Linux host and provision the platform.
        </DocCard>
        <DocCard Icon={Container} title="Deploy" href="/docs/deployments">
          Build from Git or local source and promote safely.
        </DocCard>
        <DocCard Icon={Layers3} title="Understand" href="/docs/architecture">
          See trust boundaries and runtime design.
        </DocCard>
      </div>
      <h2 id="what-runs" className={heading}>
        What you can run
      </h2>
      <p className={paragraph}>
        Dockerfiles are the primary contract. Generated recipes support Node, Bun, Python, Go, Rust,
        Ruby, and PHP.
      </p>
      <Callout title="Private alpha">
        This release is for trusted operators on a private network. It is not a public multi-tenant
        PaaS.
      </Callout>
    </>
  )
}

function DocCard({
  Icon,
  children,
  href,
  title,
}: {
  Icon: typeof Server
  children: ReactNode
  href: string
  title: string
}) {
  return (
    <Link
      to={href}
      className="flex min-h-44 flex-col rounded-[7px] border border-[#2d2c26] bg-[#11110f] p-[21px] hover:border-[#513222]"
    >
      <Icon size={18} className="text-[#f07b3e]" />
      <b className="mt-auto mb-2 text-[11px] text-[#cbc7bc]">{title}</b>
      <span className="text-[9px] leading-[1.6] text-[#77746c]">{children}</span>
    </Link>
  )
}

function InstallationDocs() {
  const specs = [
    ['CPU', 'x86-64 or ARM64 with KVM'],
    ['Memory', '16 GiB available minimum'],
    ['Storage', '100 GiB free SSD / NVMe'],
    ['Operating system', 'Linux · systemd · cgroup v2'],
  ]
  return (
    <>
      <p className={cn(serif, 'mb-[47px] text-[19px] leading-[1.68] text-[#c1bdb2]')}>
        The default topology provisions one builder VM, three worker VMs, and management services on
        the Linux host. Installation runs only after a read-only qualification check.
      </p>
      <h2 id="requirements" className={heading}>
        Host requirements
      </h2>
      <div className="my-6 border-t border-[#302f29]">
        {specs.map(([label, value]) => (
          <div
            className="grid min-h-[55px] grid-cols-[.55fr_1.45fr] items-center border-b border-[#302f29] px-3 text-[11px]"
            key={label}
          >
            <span className="text-[#747169]">{label}</span>
            <b className="font-medium text-[#c1bdb2]">{value}</b>
          </div>
        ))}
      </div>
      <Callout title="One physical failure domain">
        Three worker VMs on one host are scheduling nodes, not independent physical failure domains.
      </Callout>
      <h2 id="prepare" className={heading}>
        Prepare the checkout
      </h2>
      <p className={paragraph}>
        Install Nix, enter the pinned environment, and create local configuration.
      </p>
      <CodeBlock>{`nix develop\ninstall -d -m 700 .local\ncp platform.example.json .local/platform.json`}</CodeBlock>
      <h2 id="validate" className={heading}>
        Validate before provisioning
      </h2>
      <p className={paragraph}>
        The setup check is read-only. Review every requirement before installation makes host-level
        changes.
      </p>
      <CodeBlock>{`make setup-check\nmake setup-install`}</CodeBlock>
      <h2 id="development" className={heading}>
        Development without VMs
      </h2>
      <CodeBlock>{`pnpm install --frozen-lockfile\nmake db\nmake bootstrap-auth\nmake api\nmake web`}</CodeBlock>
    </>
  )
}

function DeploymentDocs() {
  return (
    <>
      <p className={cn(serif, 'mb-[47px] text-[19px] leading-[1.68] text-[#c1bdb2]')}>
        A deployment pins source, produces an immutable OCI image, starts a candidate, and waits for
        real readiness before changing traffic.
      </p>
      <h2 id="source" className={heading}>
        1. Connect source
      </h2>
      <p className={paragraph}>
        Choose a Git branch, tag, commit, or local upload. Mutable references resolve once before
        the build.
      </p>
      <h2 id="builds" className={heading}>
        2. Configure the build
      </h2>
      <p className={paragraph}>
        Use a Dockerfile for full control or a recorded generated recipe for supported repositories.
      </p>
      <div className="my-6 flex gap-3 rounded-lg border border-[#302f29] bg-[#11110f] p-5">
        <FileCode2 size={18} className="text-[#f07b3e]" />
        <span className="text-[11px] text-[#cbc7bc]">
          Dockerfile-first, with explicit context, port, and health checks.
        </span>
      </div>
      <h2 id="health" className={heading}>
        3. Define health
      </h2>
      <p className={paragraph}>
        Set an application port and explicit readiness check. The platform does not infer a safe
        probe from EXPOSE.
      </p>
      <h2 id="promote" className={heading}>
        4. Deploy and observe
      </h2>
      <p className={paragraph}>
        Candidates move through building, preparing, stabilizing, promoting, and draining. Before
        promotion, failure leaves active traffic untouched.
      </p>
      <Callout title="No optimistic success">
        A registered commit is not a built image, and a started container is not a healthy
        deployment.
      </Callout>
    </>
  )
}

function ArchitectureDocs() {
  const rows = [
    [
      '01',
      'Rust control plane',
      'Persists desired state, reconciles work, and schedules placement.',
    ],
    ['02', 'Isolated builder', 'BuildKit produces immutable image digests away from workers.'],
    [
      '03',
      'Authenticated node agents',
      'Workers reconcile generations behind a runtime-independent contract.',
    ],
    [
      '04',
      'Independent edge worker',
      'Public route changes and promotion acknowledgements remain separate.',
    ],
  ]
  return (
    <>
      <p className={cn(serif, 'mb-[47px] text-[19px] leading-[1.68] text-[#c1bdb2]')}>
        local/paas separates management, builds, workload execution, secret storage, and public
        routing.
      </p>
      <h2 id="components" className={heading}>
        Core components
      </h2>
      <div className="border-t border-[#302f29]">
        {rows.map(([number, title, description]) => (
          <div
            className="grid grid-cols-[42px_1fr] gap-5 border-b border-[#302f29] py-[22px]"
            key={number}
          >
            <span className="font-mono text-[9px] text-[#f07b3e]">{number}</span>
            <div>
              <b className="text-xs text-[#d4cfc4]">{title}</b>
              <p className="mt-1 text-[11px] leading-[1.85] text-[#98958c]">{description}</p>
            </div>
          </div>
        ))}
      </div>
      <h2 id="networking" className={heading}>
        Networking
      </h2>
      <p className={paragraph}>
        Workloads get isolated network namespaces and declared public ports. Private connections are
        explicit service references.
      </p>
      <h2 id="storage" className={heading}>
        State and storage
      </h2>
      <p className={paragraph}>
        PostgreSQL stores desired state and audit history. ClickHouse retains logs. OpenBao holds
        workload secrets. Local volumes are node-pinned.
      </p>
      <h2 id="security" className={heading}>
        Security boundaries
      </h2>
      <p className={paragraph}>
        Builds and workloads do not receive broad management access, host filesystems, raw runtime
        sockets, or database credentials.
      </p>
    </>
  )
}

function DocsBody({ page }: { page: DocsPage }) {
  if (page === 'installation') return <InstallationDocs />
  if (page === 'deployments') return <DeploymentDocs />
  if (page === 'architecture') return <ArchitectureDocs />
  return <IntroductionDocs />
}

export function DocsSite({ page }: { page: DocsPage }) {
  const path = useRouterState({ select: (state) => state.location.pathname })
  const [query, setQuery] = useState('')
  const [navOpen, setNavOpen] = useState(false)
  const meta = docsMeta[page]
  const results = useMemo(() => {
    const value = query.trim().toLowerCase()
    return value
      ? docsNavigation
          .flatMap((group) => group.items)
          .filter((item) => item.title.toLowerCase().includes(value))
      : []
  }, [query])
  useEffect(() => {
    setNavOpen(false)
    setQuery('')
  }, [path])
  return (
    <div className="min-h-screen bg-[#0b0b09] font-sans text-[#f3f0e8] [color-scheme:dark]">
      <PublicHeader docs />
      <div className="sticky top-[68px] z-40 grid min-h-[57px] grid-cols-[230px_minmax(280px,520px)_1fr] items-center gap-7 border-b border-[#20201c] bg-[#0d0d0bec] px-[max(24px,calc((100vw-1400px)/2))] backdrop-blur-lg max-[720px]:top-[62px] max-[720px]:grid-cols-[auto_1fr] max-[720px]:gap-2.5 max-[720px]:p-2.5 max-[720px]:px-4">
        <button
          className="hidden h-[34px] items-center gap-1.5 rounded-md border border-[#302f29] bg-[#161613] px-2.5 text-[10px] max-[720px]:flex"
          type="button"
          onClick={() => setNavOpen((value) => !value)}
        >
          <Menu size={16} /> Menu
        </button>
        <div className="relative flex items-center">
          <Search size={15} className="absolute left-[13px] text-[#65635c]" />
          <input
            className="h-[34px] w-full rounded-md border border-[#302f29] bg-[#161613] pr-4 pl-[37px] text-[11px]"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search documentation…"
            aria-label="Search documentation"
          />
          {query && (
            <div className="absolute top-[42px] right-0 left-0 grid rounded-md border border-[#37362f] bg-[#161613] shadow-xl">
              {results.length ? (
                results.map((result) => (
                  <a
                    className="flex h-10 items-center justify-between border-b border-[#292822] px-3 text-[11px]"
                    href={result.href}
                    key={result.href}
                  >
                    {result.title}
                    <ArrowRight size={13} />
                  </a>
                ))
              ) : (
                <span className="p-3 text-[11px]">No matching guides</span>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="mx-auto grid min-h-[calc(100vh-125px)] w-[min(1400px,100%)] grid-cols-[230px_minmax(0,1fr)] max-[720px]:block">
        <DocsSidebar open={navOpen} path={path} />
        <main className="grid grid-cols-[minmax(0,760px)_170px] justify-center gap-[70px] px-[45px] pt-[57px] pb-[110px] max-[980px]:grid-cols-[minmax(0,720px)] max-[720px]:block max-[720px]:px-[22px] max-[720px]:pt-10">
          <article>
            <div className="mb-[42px] flex items-center gap-2 font-mono text-[9px] text-[#5f5d56] uppercase">
              <Link to="/docs">Docs</Link>
              <ChevronRight size={12} />
              <span>{meta[0]}</span>
            </div>
            <div className="mb-[50px] border-b border-[#292822] pb-[43px]">
              <span className="font-mono text-[9px] tracking-[.12em] text-[#f07b3e]">
                {meta[0]}
              </span>
              <h1
                className={cn(
                  serif,
                  'mt-3 mb-3 text-[clamp(42px,5vw,60px)] leading-none font-normal tracking-[-.05em] text-[#e8e1d2]',
                )}
              >
                {meta[1]}
              </h1>
              <p className="text-[13px] text-[#858279]">{meta[2]}</p>
            </div>
            <DocsBody page={page} />
          </article>
          <aside className="sticky top-[165px] h-max border-l border-[#292822] pl-[18px] text-[9px] text-[#706e66] max-[980px]:hidden">
            <span className="font-mono text-[8px] text-[#56544d]">ON THIS PAGE</span>
          </aside>
        </main>
      </div>
    </div>
  )
}

function DocsSidebar({ open, path }: { open: boolean; path: string }) {
  return (
    <aside
      className={cn(
        'sticky top-[125px] flex h-[calc(100vh-125px)] flex-col border-r border-[#20201c] bg-[#0d0d0b] px-6 py-[30px] max-[720px]:fixed max-[720px]:top-[117px] max-[720px]:bottom-0 max-[720px]:left-0 max-[720px]:z-45 max-[720px]:h-auto max-[720px]:w-[min(300px,86vw)] max-[720px]:-translate-x-[105%] max-[720px]:overflow-y-auto max-[720px]:transition-transform',
        open && 'max-[720px]:translate-x-0',
      )}
    >
      <div className="mb-8 flex gap-2">
        <span className="rounded border border-[#4d3022] bg-[#24150e] px-1.5 py-1 font-mono text-[8px] text-[#ff985f]">
          v0.1
        </span>
        <b className="text-[9px] font-medium text-[#77746b]">Development alpha</b>
      </div>
      <nav>
        {docsNavigation.map((group) => (
          <div className="mb-7 grid gap-1" key={group.label}>
            <span className="mb-1 font-mono text-[8px] tracking-[.12em] text-[#56544d] uppercase">
              {group.label}
            </span>
            {group.items.map((item) => (
              <a
                className="-ml-2 rounded px-2 py-[7px] text-[10px] text-[#858279] hover:bg-[#181814] data-[active]:bg-[#181814] data-[active]:text-[#e3ded2] data-[active]:shadow-[inset_2px_0_#f07b3e]"
                href={item.href}
                key={item.href}
                data-active={item.href === path ? true : undefined}
              >
                {item.title}
              </a>
            ))}
          </div>
        ))}
      </nav>
      <div className="mt-auto flex gap-2 rounded-md border border-[#292822] p-4 text-[9px] text-[#615f57]">
        <Code2 size={15} />
        <span>
          Open source
          <br />
          <a href={repositoryUrl}>Read the code</a>
        </span>
      </div>
    </aside>
  )
}
