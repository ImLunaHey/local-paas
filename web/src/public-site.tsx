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
import { Highlight, themes, type Language } from 'prism-react-renderer'

const repositoryUrl = 'https://github.com/ImLunaHey/local-paas'
const serif = "font-[Georgia,'Times_New_Roman',serif]"
const overline = 'font-mono text-[10px] font-semibold tracking-[.12em] text-[#ff985f] uppercase'
const button =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-[7px] border border-[#f07b3e] bg-[#f07b3e] px-[18px] text-xs font-semibold text-[#1a0d07] shadow-[inset_0_1px_0_#ffffff30,0_8px_28px_#f07b3e18] hover:-translate-y-px hover:bg-[#ff985f]'

type DocsPath =
  | '/docs'
  | '/docs/installation'
  | '/docs/nodejs'
  | '/docs/python'
  | '/docs/go'
  | '/docs/rust'
  | '/docs/other-runtimes'
  | '/docs/dockerfile'
  | '/docs/deployments'
  | '/docs/builds'
  | '/docs/health-checks'
  | '/docs/source-uploads'
  | '/docs/variables'
  | '/docs/networking'
  | '/docs/storage'
  | '/docs/environments'
  | '/docs/observability'
  | '/docs/github'
  | '/docs/scaling'
  | '/docs/jobs'
  | '/docs/nodes'
  | '/docs/backups'
  | '/docs/api'
  | '/docs/upgrades'

type DocsNavigationGroup = {
  label: string
  items: { title: string; to: DocsPath }[]
}

const docsNavigation: DocsNavigationGroup[] = [
  {
    label: 'Start here',
    items: [
      { title: 'Overview', to: '/docs' },
      { title: 'Deploy an application', to: '/docs/deployments' },
    ],
  },
  {
    label: 'Languages',
    items: [
      { title: 'Node.js & Bun', to: '/docs/nodejs' },
      { title: 'Python', to: '/docs/python' },
      { title: 'Go', to: '/docs/go' },
      { title: 'Rust', to: '/docs/rust' },
      { title: 'Dockerfile', to: '/docs/dockerfile' },
      { title: 'Ruby & PHP', to: '/docs/other-runtimes' },
    ],
  },
  {
    label: 'Deployments',
    items: [
      { title: 'Builds & start commands', to: '/docs/builds' },
      { title: 'Source uploads', to: '/docs/source-uploads' },
      { title: 'Health checks & rollbacks', to: '/docs/health-checks' },
    ],
  },
  {
    label: 'Configure',
    items: [
      { title: 'Environment variables & secrets', to: '/docs/variables' },
      { title: 'Domains & networking', to: '/docs/networking' },
      { title: 'Databases & storage', to: '/docs/storage' },
      { title: 'Environments', to: '/docs/environments' },
    ],
  },
  {
    label: 'Operate',
    items: [
      { title: 'Logs & metrics', to: '/docs/observability' },
      { title: 'GitHub deployments', to: '/docs/github' },
      { title: 'Replicas & autoscaling', to: '/docs/scaling' },
      { title: 'Workers & jobs', to: '/docs/jobs' },
    ],
  },
  {
    label: 'Reference',
    items: [{ title: 'HTTP API', to: '/docs/api' }],
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
          <Link className="text-xs text-[#9d9a8f] hover:text-[#f3f0e8]" to="/docs/nodejs">
            Node.js guide
          </Link>
          <a className="text-xs text-[#9d9a8f] hover:text-[#f3f0e8]" href={repositoryUrl}>
            GitHub
          </a>
        </nav>
        <div className="flex items-center justify-self-end gap-[22px] max-[720px]:hidden">
          <Link className="text-xs text-[#9d9a8f]" to="/app">
            Sign in
          </Link>
          <Link className={cn(button, 'min-h-9 px-3.5 text-[11px]')} to="/docs/nodejs">
            Start deploying <ArrowRight size={13} />
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
          <Link className="border-b border-[#23221e] p-3 text-xs text-[#b1ada3]" to="/docs/nodejs">
            Deploy Node.js
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
          to="/docs"
        >
          Explore the platform <ArrowRight size={14} />
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
          <Link to="/docs/nodejs">Node.js guide</Link>
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

export type DocsPage =
  | 'introduction'
  | 'installation'
  | 'nodejs'
  | 'python'
  | 'go'
  | 'rust'
  | 'other-runtimes'
  | 'dockerfile'
  | 'deployments'
  | 'builds'
  | 'health'
  | 'source-uploads'
  | 'variables'
  | 'networking'
  | 'storage'
  | 'environments'
  | 'observability'
  | 'github'
  | 'scaling'
  | 'jobs'
  | 'nodes'
  | 'backups'
  | 'api'
  | 'upgrades'
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
  nodejs: [
    'QUICKSTART',
    'Deploy a Node.js app',
    'Build and run a production Node.js service from a Git repository.',
  ],
  python: [
    'QUICKSTART',
    'Deploy a Python app',
    'Build a locked Python service with uv and an explicit production start command.',
  ],
  go: [
    'QUICKSTART',
    'Deploy a Go app',
    'Compile and run a standalone Go HTTP service from a locked module.',
  ],
  rust: [
    'LANGUAGES',
    'Deploy a Rust app',
    'Build a release binary from a locked Cargo project and run it as a service.',
  ],
  'other-runtimes': [
    'LANGUAGES',
    'Bun, Ruby & PHP',
    'Required files and runtime commands for the remaining generated recipes.',
  ],
  dockerfile: [
    'QUICKSTART',
    'Deploy with a Dockerfile',
    'Use your existing Dockerfile as the exact build and runtime contract.',
  ],
  builds: [
    'DEPLOYMENTS',
    'Builds & start commands',
    'Choose a build mode, configure the process, and understand build output.',
  ],
  health: [
    'DEPLOYMENTS',
    'Health checks & rollbacks',
    'Define readiness, understand promotion, and recover a previous healthy revision.',
  ],
  'source-uploads': [
    'DEPLOYMENTS',
    'Upload local source',
    'Deploy a ZIP archive or local files without connecting a Git provider.',
  ],
  variables: [
    'CONFIGURE',
    'Environment variables & secrets',
    'Configure applications without putting sensitive values in source or image layers.',
  ],
  networking: [
    'CONFIGURE',
    'Domains & networking',
    'Expose a service, choose its port, and connect services privately.',
  ],
  storage: [
    'CONFIGURE',
    'Databases & storage',
    'Add PostgreSQL, Redis, object storage, or persistent volumes to an application.',
  ],
  environments: [
    'CONFIGURE',
    'Environments',
    'Separate production, development, and preview workloads inside a project.',
  ],
  observability: [
    'OPERATE',
    'Logs & metrics',
    'Inspect deployment events, runtime output, health, and resource usage.',
  ],
  github: [
    'OPERATE',
    'GitHub deployments',
    'Deploy commits automatically and create isolated pull request previews.',
  ],
  scaling: [
    'OPERATE',
    'Replicas & autoscaling',
    'Scale stateless HTTP services manually or with a conservative CPU policy.',
  ],
  jobs: [
    'OPERATE',
    'Workers & jobs',
    'Run long-lived workers, one-off commands, schedules, and pre-deploy tasks.',
  ],
  nodes: [
    'OPERATE',
    'Nodes & scaling',
    'Place, scale, and relocate workloads across registered workers.',
  ],
  backups: [
    'OPERATE',
    'Backups & restore',
    'Protect control-plane state, secrets, source archives, and application data.',
  ],
  api: [
    'REFERENCE',
    'HTTP API',
    'Automate projects, services, deployments, scaling, domains, and previews.',
  ],
  upgrades: ['REFERENCE', 'Upgrade guide', 'Plan and verify a safe platform upgrade.'],
} satisfies Record<DocsPage, [string, string, string]>
const paragraph = 'text-[15px] leading-[1.8] text-[#a9a69c]'
const heading =
  'mt-[62px] mb-5 scroll-mt-[155px] text-2xl font-medium tracking-[-.025em] text-[#e1ddd2]'

const languageLabels: Partial<Record<Language, string>> = {
  bash: 'Shell',
  docker: 'Dockerfile',
  go: 'Go',
  javascript: 'JavaScript',
  json: 'JSON',
  rust: 'Rust',
  toml: 'TOML',
}

function CodeBlock({ children, language = 'bash' }: { children: string; language?: Language }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    await navigator.clipboard.writeText(children)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1_500)
  }
  return (
    <div className="my-[27px] overflow-hidden rounded-lg border border-[#302f29] bg-[#0c0c0a]">
      <div className="flex h-9 items-center justify-between border-b border-[#25241f] bg-[#131310] px-3 font-mono text-[9px] text-[#5d5b54]">
        <span>{languageLabels[language] ?? language}</span>
        <button
          type="button"
          className="flex items-center gap-1 bg-transparent text-[#8b887f]"
          onClick={() => void copy()}
        >
          <Copy size={13} />
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <Highlight code={children.trim()} language={language} theme={themes.vsDark}>
        {({ tokens, getLineProps, getTokenProps }) => (
          <pre className="m-0 overflow-x-auto bg-transparent p-[21px] font-mono text-[12px] leading-[1.85]">
            <code>
              {tokens.map((line, lineIndex) => {
                const lineProps = getLineProps({ line })
                return (
                  <span
                    className={cn('table-row', lineProps.className)}
                    key={lineIndex}
                    style={lineProps.style}
                  >
                    <span className="table-cell w-8 pr-5 text-right text-[#4f4d47] select-none">
                      {lineIndex + 1}
                    </span>
                    <span className="table-cell">
                      {line.map((token, tokenIndex) => {
                        const tokenProps = getTokenProps({ token })
                        return (
                          <span
                            className={tokenProps.className}
                            key={tokenIndex}
                            style={tokenProps.style}
                          >
                            {tokenProps.children}
                          </span>
                        )
                      })}
                    </span>
                  </span>
                )
              })}
            </code>
          </pre>
        )}
      </Highlight>
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
        <DocCard Icon={Container} title="Deploy Node.js" href="/docs/nodejs">
          Ship a locked Node.js repository without a Dockerfile.
        </DocCard>
        <DocCard Icon={FileCode2} title="Use a Dockerfile" href="/docs/dockerfile">
          Bring an explicit build and runtime contract.
        </DocCard>
        <DocCard Icon={Code2} title="Automate with the API" href="/docs/api">
          Create services, deploy, scale, and inspect health.
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

type GuideSection = {
  id: string
  title: string
  body: string
  bullets?: string[]
  code?: string
  language?: Language
  visual?: DocVisualKind
}

type DocVisualKind =
  | 'service'
  | 'deployment'
  | 'health'
  | 'secrets'
  | 'domain'
  | 'database'
  | 'metrics'
  | 'preview'
  | 'scaling'
  | 'job'

const visualStates: Record<
  DocVisualKind,
  { eyebrow: string; title: string; status: string; rows: [string, string, string?][] }
> = {
  service: {
    eyebrow: 'NEW SERVICE / APP',
    title: 'web-production',
    status: 'Ready to build',
    rows: [
      ['Source', 'acme/web · main'],
      ['Build', 'Automatic'],
      ['Start command', 'npm start'],
      ['Port', '3000'],
    ],
  },
  deployment: {
    eyebrow: 'DEPLOYMENT / 7F2A1C9',
    title: 'Production rollout',
    status: 'Healthy',
    rows: [
      ['Build', 'Image created', 'done'],
      ['Prepare', '2 replicas started', 'done'],
      ['Stabilize', 'Readiness passed', 'done'],
      ['Promote', 'Traffic moved', 'active'],
    ],
  },
  health: {
    eyebrow: 'HEALTH / ACTIVE REVISION',
    title: '2 of 2 replicas ready',
    status: 'Serving',
    rows: [
      ['worker-01', 'GET /health · 18 ms', 'done'],
      ['worker-02', 'GET /health · 21 ms', 'done'],
      ['Previous revision', 'Retained for rollback'],
    ],
  },
  secrets: {
    eyebrow: 'CONFIGURATION / SECRETS',
    title: 'Runtime variables',
    status: '3 configured',
    rows: [
      ['DATABASE_URL', 'Secret · inherited'],
      ['STRIPE_KEY', 'Secret · local override'],
      ['NODE_ENV', 'production'],
    ],
  },
  domain: {
    eyebrow: 'NETWORKING / DOMAINS',
    title: 'api.example.com',
    status: 'TLS active',
    rows: [
      ['Target', 'web-production:3000'],
      ['DNS ownership', 'Verified', 'done'],
      ['Route health', '2 healthy backends', 'active'],
    ],
  },
  database: {
    eyebrow: 'NEW SERVICE / DATABASE',
    title: 'primary-postgres',
    status: 'Available',
    rows: [
      ['Engine', 'PostgreSQL'],
      ['Environment', 'production'],
      ['Connection', 'Injected as secret'],
      ['Backup', 'Last run succeeded', 'done'],
    ],
  },
  metrics: {
    eyebrow: 'RUNTIME / LAST 15 MINUTES',
    title: 'web-production',
    status: 'Live',
    rows: [
      ['CPU', '42%', 'meter'],
      ['Memory', '318 / 512 MiB', 'meter'],
      ['Requests', '184 / min'],
      ['Restarts', '0'],
    ],
  },
  preview: {
    eyebrow: 'PULL REQUEST / #184',
    title: 'feat/checkout-redesign',
    status: 'Preview ready',
    rows: [
      ['Commit', 'f7a21c9'],
      ['Build', 'Succeeded', 'done'],
      ['Environment', 'pr-184'],
      ['Private URL', 'Open preview', 'active'],
    ],
  },
  scaling: {
    eyebrow: 'CONFIGURATION / AUTOSCALING',
    title: 'CPU scaling policy',
    status: 'Enabled',
    rows: [
      ['Replica range', '1 — 4'],
      ['CPU target', '70%', 'meter'],
      ['Scale out after', '30 seconds'],
      ['Current decision', 'Hold at 2 replicas', 'done'],
    ],
  },
  job: {
    eyebrow: 'JOBS / MIGRATE-DATABASE',
    title: 'Pre-deploy command',
    status: 'Exited 0',
    rows: [
      ['Revision', '7f2a1c9'],
      ['Command', 'pnpm db:migrate'],
      ['Duration', '12.8 seconds'],
      ['Next step', 'Starting candidates', 'active'],
    ],
  },
}

function ProductMock({ kind }: { kind: DocVisualKind }) {
  const state = visualStates[kind]
  return (
    <figure className="my-8 overflow-hidden rounded-xl border border-[#34332c] bg-[#10100e] shadow-[0_20px_50px_#0005]">
      <figcaption className="flex items-center gap-2 border-b border-[#292822] bg-[#151512] px-4 py-3 font-mono text-[10px] tracking-[.08em] text-[#77746c]">
        <span className="size-2 rounded-full bg-[#514f48]" />
        <span className="size-2 rounded-full bg-[#514f48]" />
        <span className="size-2 rounded-full bg-[#f07b3e]" />
        <span className="ml-2">EXAMPLE DASHBOARD STATE</span>
      </figcaption>
      <div className="p-5 max-[720px]:p-4">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <span className="font-mono text-[10px] tracking-[.08em] text-[#69675f]">
              {state.eyebrow}
            </span>
            <h3 className="mt-1.5 text-[16px] font-semibold text-[#e4dfd4]">{state.title}</h3>
          </div>
          <span className="shrink-0 rounded-full border border-[#35533c] bg-[#142219] px-2.5 py-1 text-[10px] font-medium text-[#91c09a]">
            {state.status}
          </span>
        </div>
        <div className="overflow-hidden rounded-lg border border-[#2c2b25]">
          {state.rows.map(([label, value, treatment]) => (
            <div
              className="grid min-h-12 grid-cols-[minmax(110px,.7fr)_1.3fr] items-center gap-4 border-b border-[#292822] px-4 text-[12px] last:border-0 max-[480px]:grid-cols-1 max-[480px]:gap-1 max-[480px]:py-3"
              key={label}
            >
              <span className="text-[#77746c]">{label}</span>
              <span
                className={cn(
                  'flex items-center gap-2 font-medium text-[#cbc6ba]',
                  treatment === 'active' && 'text-[#ff985f]',
                  treatment === 'done' && 'text-[#91c09a]',
                )}
              >
                {treatment === 'done' && <Check size={13} />}
                {treatment === 'active' && <CircleDot size={13} />}
                {value}
                {treatment === 'meter' && (
                  <span className="ml-auto h-1.5 w-20 overflow-hidden rounded-full bg-[#292822]">
                    <span className="block h-full w-[58%] rounded-full bg-[#f07b3e]" />
                  </span>
                )}
              </span>
            </div>
          ))}
        </div>
      </div>
    </figure>
  )
}

const guideContent: Partial<Record<DocsPage, { lead: string; sections: GuideSection[] }>> = {
  nodejs: {
    lead: 'This quickstart takes a Node.js repository from a committed lockfile to a healthy production URL. You do not need to write a Dockerfile for a supported standalone app.',
    sections: [
      {
        id: 'prepare',
        title: '1. Prepare your repository',
        body: 'Keep package.json and exactly one lockfile at the repository root. The generated recipe uses scripts.build when it exists and scripts.start to launch the service.',
        bullets: [
          'npm: package-lock.json',
          'pnpm: pnpm-lock.yaml',
          'Yarn: yarn.lock',
          'Bun: bun.lock or bun.lockb',
        ],
        code: `{
  "scripts": {
    "build": "tsc",
    "start": "node dist/server.js"
  },
  "engines": { "node": ">=22" }
}`,
        language: 'json',
      },
      {
        id: 'listen',
        title: '2. Listen on the configured port',
        body: 'Bind the HTTP server to 0.0.0.0, not localhost. In the service form, set the same container port your process listens on and choose an explicit readiness path such as /health.',
        code: `const port = Number(process.env.PORT ?? 3000)
app.listen(port, '0.0.0.0')`,
        language: 'javascript',
      },
      {
        id: 'create',
        title: '3. Create the service',
        body: 'Open a project and environment, choose New service → App, connect the repository, and leave Build mode on Automatic. Select the branch or commit you want to deploy, then set the port and readiness path.',
        visual: 'service',
      },
      {
        id: 'deploy',
        title: '4. Build and deploy',
        body: 'Choose Create and build. Follow the build output until an immutable image digest is recorded, then deploy it. Traffic changes only after the candidate passes readiness and stabilization.',
        visual: 'deployment',
      },
      {
        id: 'troubleshoot',
        title: 'Common Node.js failures',
        body: 'A missing or ambiguous lockfile stops recipe detection. A missing start script requires an explicit start command. Workspace roots and unsupported native dependencies should use a reviewed Dockerfile.',
      },
    ],
  },
  python: {
    lead: 'The generated Python recipe installs a frozen uv environment. You provide the production entrypoint because the platform does not guess your framework or module layout.',
    sections: [
      {
        id: 'prepare',
        title: '1. Lock dependencies',
        body: 'Commit pyproject.toml and uv.lock at the selected build context root. Mixed-language roots, missing locks, and unsupported native system dependencies should use a Dockerfile.',
        code: `[project]
name = "example-api"
requires-python = ">=3.13"
dependencies = ["fastapi", "uvicorn[standard]"]`,
        language: 'toml',
      },
      {
        id: 'start',
        title: '2. Set the start command',
        body: 'In Build settings, use an explicit production command and bind it to every interface. Commands are visible configuration, so never include secret values.',
        code: 'exec uv run uvicorn app:app --host 0.0.0.0 --port 8000',
        language: 'bash',
      },
      {
        id: 'configure',
        title: '3. Configure the service',
        body: 'Choose Automatic or Generated build mode, set container port 8000, and configure a lightweight readiness path. Add environment variables and secrets separately from the command.',
      },
      {
        id: 'deploy',
        title: '4. Deploy',
        body: 'Create and build the service, inspect the frozen dependency install, then deploy the resulting image. The route changes only after the Python process passes readiness and stabilization.',
      },
    ],
  },
  go: {
    lead: 'The Go recipe compiles the root package to /app/app and uses that binary as the default runtime command.',
    sections: [
      {
        id: 'prepare',
        title: '1. Prepare the module',
        body: 'Commit go.mod and go.sum at the build context root. The root package must build as an application; use a Dockerfile for a monorepo or a command in another directory.',
        code: `module example.com/api

go 1.25`,
        language: 'go',
      },
      {
        id: 'listen',
        title: '2. Listen for HTTP',
        body: 'Bind the server to 0.0.0.0 and the configured container port. Keep a cheap endpoint for readiness checks.',
        code: `port := os.Getenv("PORT")
if port == "" { port = "8080" }
log.Fatal(http.ListenAndServe(":"+port, mux))`,
        language: 'go',
      },
      {
        id: 'build',
        title: '3. Build from source',
        body: 'Create an App, connect the repository, and leave build mode on Automatic. With no Dockerfile present, the locked root package is compiled into a minimal runtime image.',
      },
      {
        id: 'deploy',
        title: '4. Deploy and verify',
        body: 'Set the port and readiness path, create the build, then deploy its immutable digest. Review runtime logs and health history before assigning a production domain.',
      },
    ],
  },
  rust: {
    lead: 'Rust projects use cargo build --locked --release. Because a Cargo manifest can produce several binaries, you must state exactly what to run.',
    sections: [
      {
        id: 'prepare',
        title: '1. Commit the lockfile',
        body: 'Place Cargo.toml and Cargo.lock at the build context root. Generated recipes support standalone applications; workspaces and extra system libraries should use a Dockerfile.',
      },
      {
        id: 'command',
        title: '2. Set the runtime command',
        body: 'Set an explicit start command naming the release binary. Use exec so the process receives shutdown signals directly.',
        code: 'exec ./target/release/example-api',
        language: 'bash',
      },
      {
        id: 'network',
        title: '3. Configure networking',
        body: 'Bind the server to 0.0.0.0, set its container port in Configuration, and expose a readiness endpoint that does not depend on slow external work.',
      },
      {
        id: 'deploy',
        title: '4. Deploy the release image',
        body: 'Inspect the locked release build, deploy the recorded digest, and wait for readiness stabilization before attaching traffic.',
      },
    ],
  },
  'other-runtimes': {
    lead: 'Bun, Ruby, and PHP have reviewed generated recipes for straightforward standalone applications. More complex repositories should provide a Dockerfile.',
    sections: [
      {
        id: 'bun',
        title: 'Bun',
        body: 'Commit package.json and a Bun lockfile. The recipe uses scripts.build when present and scripts.start at runtime. A pinned Bun version must match the supported preset.',
      },
      {
        id: 'ruby',
        title: 'Ruby',
        body: 'Commit Gemfile and Gemfile.lock with an exact Bundler version, then provide an explicit start command such as exec bundle exec puma -C config/puma.rb.',
      },
      {
        id: 'php',
        title: 'PHP',
        body: 'Commit composer.json and composer.lock. Production Composer dependencies are installed during the build; provide the server command and configured port explicitly.',
      },
      {
        id: 'dockerfile',
        title: 'When to use a Dockerfile',
        body: 'Use a Dockerfile for monorepos, mixed-language roots, native OS packages, custom web servers, or any runtime layout outside the reviewed recipe contract.',
      },
    ],
  },
  dockerfile: {
    lead: 'A Dockerfile is the most explicit deployment contract. Automatic mode prefers a Dockerfile when one exists; Dockerfile mode requires it.',
    sections: [
      {
        id: 'contract',
        title: 'Dockerfile contract',
        body: 'The file and build context must be repository-relative. BuildKit runs the build in an isolated builder and records the resulting image digest. The image must support the worker CPU architecture.',
      },
      {
        id: 'example',
        title: 'Minimal example',
        body: 'Use a small runtime image, install locked dependencies, and keep the runtime command in the image.',
        code: `FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
CMD ["npm", "start"]`,
        language: 'docker',
      },
      {
        id: 'runtime',
        title: 'Runtime settings',
        body: 'EXPOSE is documentation only. Set the container port and readiness path in the service configuration, and make the process listen on 0.0.0.0.',
      },
      {
        id: 'private-dependencies',
        title: 'Private dependencies',
        body: 'Build credentials are session-scoped and do not become image layers or runtime variables. Custom Dockerfile frontends and insecure BuildKit entitlements are disabled.',
      },
    ],
  },
  builds: {
    lead: 'Every build starts from pinned source and ends with either a recorded immutable image digest or an explicit failure.',
    sections: [
      {
        id: 'modes',
        title: 'Choose a build mode',
        body: 'Automatic prefers an existing Dockerfile, otherwise it detects one supported root ecosystem. Generated deliberately ignores a repository Dockerfile. Dockerfile mode never applies command overrides.',
      },
      {
        id: 'recipes',
        title: 'Generated recipes',
        body: 'Generated recipes support Node, Bun, Python, Go, Rust, Ruby, and PHP with committed lockfiles. Ambiguous roots, unsupported workspaces, and unreviewed native dependencies fail with guidance instead of guessing.',
      },
      {
        id: 'commands',
        title: 'Build and start commands',
        body: 'Overrides are captured in the generated recipe and visible in build history. Python, Go, Rust, Ruby, and PHP require an explicit start command because the platform does not infer frameworks or entrypoints.',
      },
      {
        id: 'diagnostics',
        title: 'Read build diagnostics',
        body: 'The Builds page shows source identity, detector and generator versions, effective commands, required files, image digest, and logs. A failed build cannot be deployed.',
      },
    ],
  },
  health: {
    lead: 'Health is a deployment gate and a continuous runtime signal. local/paas does not equate a built image or started process with a working application.',
    sections: [
      {
        id: 'readiness',
        title: 'Readiness checks',
        body: 'Set the container port and an explicit HTTP readiness path such as /health. The candidate must answer successfully through its worker endpoint before it can receive application traffic.',
      },
      {
        id: 'stabilization',
        title: 'Stabilization and promotion',
        body: 'After the first healthy response, the candidate remains in stabilization long enough to prove the result is not transient. Only then does the edge promote the new revision and acknowledge the route.',
        visual: 'health',
      },
      {
        id: 'continuous-health',
        title: 'Continuous health',
        body: 'Readiness, liveness, process exits, and agent reachability remain separate observations. Repeated failures withdraw an unhealthy backend and can trigger bounded restart or replacement behavior.',
      },
      {
        id: 'failed-candidate',
        title: 'When a candidate fails',
        body: 'A failure before promotion leaves the previous healthy revision serving traffic. Inspect the deployment timeline, instance health history, and logs before retrying with a corrected image or configuration.',
      },
      {
        id: 'rollback',
        title: 'Roll back a deployment',
        body: 'Choose a previous deployment with a retained image, start rollback, and wait for that revision to pass current readiness. The platform restores and acknowledges the old healthy route before stopping the failed candidate.',
      },
      {
        id: 'limits',
        title: 'Rollback limits',
        body: 'Rollback is not a time machine: it reuses an immutable image but still applies current platform availability constraints. No traffic guarantee exists when neither the current nor selected revision can become healthy.',
      },
    ],
  },
  'source-uploads': {
    lead: 'Use a ZIP or select local files when the source is not hosted by a connected Git provider.',
    sections: [
      {
        id: 'upload',
        title: 'Upload source',
        body: 'Create an App in an existing project, choose ZIP or local files, and select the source. ZIP preserves nested directories; multi-file selection packages files without compression.',
      },
      {
        id: 'limits',
        title: 'Limits',
        body: 'Archives are limited to 32 MiB compressed, 128 MiB expanded, 16 MiB per file, and 10,000 entries. Local file selection accepts 30 MiB total.',
      },
      {
        id: 'safety',
        title: 'Validation',
        body: 'Traversal, symlinks, special files, encryption, duplicate paths, .git, dotenv files, node_modules, and known credential filenames are rejected before storage and again before extraction.',
      },
      {
        id: 'retention',
        title: 'Retention and rebuilds',
        body: 'Uploads are content-addressed and deduplicated. Keep source archives with control-plane backups: rollback uses retained image digests, but a future rebuild needs the archive.',
      },
    ],
  },
  variables: {
    lead: 'Configuration names live with the service specification. Secret values live in OpenBao and never appear in API responses, audit metadata, or image layers.',
    sections: [
      {
        id: 'add',
        title: 'Add variables and secrets',
        body: 'During service creation, add name/value rows under Secrets. Existing services manage them from the Secrets tab. A successful save clears acknowledged values from the browser immediately.',
        visual: 'secrets',
      },
      {
        id: 'inheritance',
        title: 'Environment inheritance',
        body: 'Child environments can inherit secret names and values from an ancestor. A local value overrides the inherited name; removing the override exposes the inherited value again.',
      },
      {
        id: 'deployments',
        title: 'Pinned deployments',
        body: 'Each deployment pins the resolved secret bundle. Editing a value does not silently change an already-running revision; deploy a new revision to use it.',
      },
      {
        id: 'files',
        title: 'Runtime delivery',
        body: 'Workloads receive variables at process start and private read-only files under /.platform-secrets. Do not print secrets: log redaction is best effort and cannot recognize transformed values.',
      },
    ],
  },
  networking: {
    lead: 'A service becomes reachable only through an explicit port and route. Saving a domain never claims success until the edge reports a healthy route.',
    sections: [
      {
        id: 'port',
        title: 'Set the application port',
        body: 'Configure the container port your process listens on. Changing it updates desired configuration; the active revision keeps its old port until a new deployment becomes healthy.',
      },
      {
        id: 'private',
        title: 'Private service URLs',
        body: 'Networking shows the active deployment port and private HTTPS endpoint. Preview endpoints require a configured private TLS proxy forwarding to the independent ingress.',
      },
      {
        id: 'domains',
        title: 'Custom domains',
        body: 'Choose a verified domain from the global Domains registry. A domain can belong to only one service, and reassignment uses version checks so stale forms cannot overwrite ownership.',
        visual: 'domain',
      },
      {
        id: 'health',
        title: 'Routing health',
        body: 'Only healthy backends receive application traffic. If a candidate fails before promotion, the previous healthy revision remains active.',
      },
    ],
  },
  storage: {
    lead: 'Create managed data services beside applications, or attach persistent storage when a workload must keep local state.',
    sections: [
      {
        id: 'databases',
        title: 'PostgreSQL and Redis',
        body: 'Choose New service → Database, select PostgreSQL or Redis, and create it in the same project and environment as the application that uses it.',
        visual: 'database',
      },
      {
        id: 'connect',
        title: 'Connect an application',
        body: 'Use the generated service connection in the application configuration. Credentials remain secret references; the UI and API do not return raw passwords.',
      },
      {
        id: 'objects',
        title: 'Object storage',
        body: 'RustFS provides S3-compatible object storage. Create a Storage service, then use its scoped endpoint and secret references from the application.',
      },
      {
        id: 'volumes',
        title: 'Persistent volumes',
        body: 'Local volumes are pinned to a node. Treat node relocation and backup planning differently for stateful services; replicas do not make one physical host highly available.',
      },
    ],
  },
  environments: {
    lead: 'Environments partition services and configuration inside a project. New projects begin with production and development.',
    sections: [
      {
        id: 'create',
        title: 'Create an environment',
        body: 'Use the Environments page to create an empty namespace or create one from a parent. A service identity cannot move between environments; register a new service in the destination.',
      },
      {
        id: 'copy',
        title: 'Copy from a parent',
        body: 'A child copies source service specifications with new service IDs and no domains. It does not deploy, copy database contents, or copy running instances.',
      },
      {
        id: 'configuration',
        title: 'Configuration inheritance',
        body: 'Configuration is copied at creation. Secret references resolve through the ancestor chain, with local values overriding inherited names.',
      },
      {
        id: 'previews',
        title: 'Pull request previews',
        body: 'GitHub preview environments are isolated and do not inherit production configuration. Their lifecycle is controlled by the parent service preview policy.',
      },
    ],
  },
  observability: {
    lead: 'Use deployment events, logs, metrics, and health history together to understand what the platform did and what the process reported.',
    sections: [
      {
        id: 'deployments',
        title: 'Deployment timeline',
        body: 'The deployment view distinguishes building, preparing, stabilizing, promoting, draining, failed, and rolled-back states. A started process is not shown as healthy until readiness succeeds.',
      },
      {
        id: 'logs',
        title: 'Runtime logs',
        body: 'Logs include deployment and real process start/restart markers. Choose an instance to inspect retained output; sensitive values are redacted on a best-effort basis.',
      },
      {
        id: 'metrics',
        title: 'Metrics',
        body: 'Inspect recent CPU and memory use per instance alongside node reachability and deployment health. Use these measurements to tune fixed replicas and capacity.',
        visual: 'metrics',
      },
      {
        id: 'health',
        title: 'Health history',
        body: 'Readiness, liveness, process exits, restart exhaustion, and recent transitions remain distinct so a routing failure is not confused with a build failure.',
      },
    ],
  },
  github: {
    lead: 'Connect GitHub to turn branch updates and pull requests into auditable builds without giving repository code control-plane credentials.',
    sections: [
      {
        id: 'connect',
        title: 'Connect a repository',
        body: 'Create a source connection, select the repository and branch, and verify the webhook. Deliveries are signed, deduplicated, and retained with their processing outcome.',
      },
      {
        id: 'automatic',
        title: 'Automatic deployments',
        body: 'Enable the service policy for the chosen branch. Each accepted delivery resolves a commit, queues a build, and deploys only the resulting immutable image.',
      },
      {
        id: 'previews',
        title: 'Pull request previews',
        body: 'Enable previews on the parent service to create isolated environment and service records for pull requests. A failed candidate preserves the previous healthy preview revision.',
        visual: 'preview',
      },
      {
        id: 'cleanup',
        title: 'Close and clean up',
        body: 'Closing a pull request queues runtime cleanup and releases its private endpoint. Historical environment and service records remain for auditability.',
      },
    ],
  },
  scaling: {
    lead: 'Scale a stateless HTTP service to a fixed replica count, or enable CPU autoscaling when the application can safely start and stop interchangeable replicas.',
    sections: [
      {
        id: 'fixed',
        title: 'Set a fixed replica count',
        body: 'Use the Runtime controls to choose the desired number of replicas. New replicas use the active immutable image, configuration, and pinned secret references, and receive no traffic before readiness.',
      },
      {
        id: 'eligibility',
        title: 'Autoscaling eligibility',
        body: 'Autoscaling is available only for stateless HTTP services. Volumes, managed databases, singleton workers, pre-deploy commands, and active jobs make a service ineligible.',
      },
      {
        id: 'policy',
        title: 'Configure a policy',
        body: 'Choose minimum and maximum replicas, a CPU target, scale-out and scale-in stabilization windows, cooldown, and the maximum replicas changed per decision. Start conservatively and leave capacity for rollouts.',
        visual: 'scaling',
      },
      {
        id: 'decisions',
        title: 'Understand decisions',
        body: 'The controller needs fresh CPU and readiness observations from every running replica. Missing metrics freeze scaling; they are never interpreted as zero usage.',
      },
      {
        id: 'zero',
        title: 'Scale to zero',
        body: 'A minimum of zero additionally requires sustained near-idle CPU and no recent requests or open response streams. The next request uses the configured waking page while a healthy replica starts.',
      },
    ],
  },
  jobs: {
    lead: 'Not every process serves HTTP. Configure a worker for a long-running consumer, or run bounded commands as jobs, schedules, and deployment gates.',
    sections: [
      {
        id: 'workers',
        title: 'Background workers',
        body: 'Choose Worker execution for a long-running process with one replica and no port, readiness path, or domain. The image or generated recipe still defines its start command.',
      },
      {
        id: 'one-off',
        title: 'One-off jobs',
        body: 'Run an explicit command against a selected service revision and follow its output and exit status. Retrying a non-idempotent command can repeat its effects, so design jobs accordingly.',
      },
      {
        id: 'schedules',
        title: 'Scheduled jobs',
        body: 'Attach an interval schedule to a tested job command. Intervals use elapsed UTC time rather than a timezone-based cron calendar.',
      },
      {
        id: 'pre-deploy',
        title: 'Pre-deploy commands',
        body: 'Use a pre-deploy command for migrations or other gates that must succeed before candidate instances start. A failed command blocks promotion and leaves the active revision untouched.',
        visual: 'job',
      },
      {
        id: 'connections',
        title: 'Configuration and connections',
        body: 'Workers and jobs receive the same pinned configuration, secrets, and private service connections as the parent service revision.',
      },
    ],
  },
  nodes: {
    lead: 'Nodes are schedulable worker VMs. Capacity, health, labels, assignments, and relocation are visible from the Nodes page.',
    sections: [
      {
        id: 'capacity',
        title: 'Capacity and placement',
        body: 'Configured allocatable CPU and memory are distinct from current usage. The scheduler reserves resources before starting an assignment and records the selected node.',
      },
      {
        id: 'scale',
        title: 'Scale replicas',
        body: 'Set a fixed replica count from the service runtime controls. Each replica has independent placement and health; multiple worker VMs on one host are still one physical failure domain.',
      },
      {
        id: 'drain',
        title: 'Drain a node',
        body: 'Drain prevents new placement and relocates eligible stateless assignments through the same health-gated handoff used for recovery.',
      },
      {
        id: 'loss',
        title: 'Node loss',
        body: 'A missing heartbeat starts replacement only after the loss threshold. Stateful, pinned, or singleton workloads may need operator action instead of automatic relocation.',
      },
    ],
  },
  backups: {
    lead: 'A useful backup covers platform state and every external data plane needed to reconstruct or continue a workload.',
    sections: [
      {
        id: 'scope',
        title: 'What to protect',
        body: 'Back up PostgreSQL desired state and audit records, OpenBao data, retained source uploads, registry data, and the application databases or object stores you operate.',
      },
      {
        id: 'run',
        title: 'Run a backup',
        body: 'Select healthy active databases and start a backup from the control plane. An unhealthy selected database fails the run instead of producing a misleading success.',
      },
      {
        id: 'restore',
        title: 'Restore safely',
        body: 'Restore into an isolated target, verify schema and object counts, then validate an application against it before changing production references.',
      },
      {
        id: 'drills',
        title: 'Practice recovery',
        body: 'A retained archive is not a recovery guarantee. Schedule restore drills and record the time, dependencies, credentials, and manual decisions required.',
      },
    ],
  },
  upgrades: {
    lead: 'Treat an upgrade as a controlled change to the management plane, agents, database schema, and build/runtime contracts.',
    sections: [
      {
        id: 'prepare',
        title: 'Before upgrading',
        body: 'Read release notes, confirm supported host resources and CPU architecture, take verified backups, and record current node and deployment health.',
      },
      {
        id: 'control-plane',
        title: 'Upgrade the control plane',
        body: 'Apply migrations with the documented release tooling and restart management services. Do not proceed while schema or health checks are failing.',
      },
      {
        id: 'workers',
        title: 'Upgrade workers',
        body: 'Drain and update workers one at a time. Confirm agent authentication, capacity, runtime health, and a successful replacement before moving to the next node.',
      },
      {
        id: 'verify',
        title: 'Verify the release',
        body: 'Build a disposable canary, deploy it through readiness, inspect logs and metrics, test its route, and confirm rollback before declaring the upgrade complete.',
      },
    ],
  },
}

function GuideDocs({ page }: { page: DocsPage }) {
  const guide = guideContent[page]
  if (!guide) return null
  return (
    <>
      <p className={cn(serif, 'mb-[47px] text-[19px] leading-[1.68] text-[#c1bdb2]')}>
        {guide.lead}
      </p>
      {guide.sections.map((section) => (
        <section key={section.id}>
          <h2 id={section.id} className={heading}>
            {section.title}
          </h2>
          <p className={paragraph}>{section.body}</p>
          {section.bullets && (
            <ul className="my-5 grid gap-2 pl-5 text-[14px] leading-7 text-[#aaa79e]">
              {section.bullets.map((bullet) => (
                <li className="list-disc pl-1" key={bullet}>
                  {bullet}
                </li>
              ))}
            </ul>
          )}
          {section.code && <CodeBlock language={section.language}>{section.code}</CodeBlock>}
          {section.visual && <ProductMock kind={section.visual} />}
        </section>
      ))}
    </>
  )
}

const apiEndpoints = [
  ['GET', '/api/projects', 'List projects'],
  ['POST', '/api/projects', 'Create a project'],
  ['GET', '/api/services', 'List services'],
  ['POST', '/api/services', 'Register a service'],
  ['POST', '/api/services/{id}/events', 'Record a service event'],
  ['POST', '/api/services/{id}/scale', 'Set replica count'],
  ['POST', '/api/deployments/{id}/rollback', 'Roll back a deployment'],
  ['GET', '/api/domains', 'List domains'],
  ['GET', '/api/source-connections', 'List source connections'],
  ['GET', '/api/source-deliveries', 'List webhook deliveries'],
  ['PUT', '/api/services/{id}/preview-policy', 'Configure PR previews'],
  ['GET', '/api/previews', 'List preview environments'],
  ['POST', '/api/specs/validate', 'Validate a service specification'],
  ['GET', '/api/health', 'Read control-plane health'],
] as const

function ApiDocs() {
  return (
    <>
      <p className={cn(serif, 'mb-[47px] text-[19px] leading-[1.68] text-[#c1bdb2]')}>
        The JSON API powers the control plane UI. Use it for scoped automation while preserving the
        same validation, audit, and health semantics as an interactive action.
      </p>
      <h2 id="authentication" className={heading}>
        Authentication
      </h2>
      <p className={paragraph}>
        Browser sessions use the platform authentication flow and HTTP-only cookies. Requests that
        mutate resources are scoped to the active organization and recorded in the audit log. Never
        put secret values in logs or reusable scripts.
      </p>
      <h2 id="conventions" className={heading}>
        Request conventions
      </h2>
      <p className={paragraph}>
        Send JSON with the appropriate content type. Resource updates use versions or ETags where
        exposed; retry with fresh state after a conflict. A queued operation is not proof of a
        successful build or healthy deployment.
      </p>
      <h2 id="endpoints" className={heading}>
        Endpoint index
      </h2>
      <div className="my-6 overflow-hidden rounded-lg border border-[#302f29]">
        {apiEndpoints.map(([method, path, summary]) => (
          <div
            className="grid grid-cols-[58px_minmax(220px,1fr)_1fr] items-center gap-3 border-b border-[#292822] px-4 py-3.5 text-[13px] last:border-0 max-[720px]:grid-cols-[54px_1fr]"
            key={`${method}-${path}`}
          >
            <span
              className={cn(
                'font-mono text-[10px] font-semibold',
                method === 'GET' ? 'text-[#83b98f]' : 'text-[#ff985f]',
              )}
            >
              {method}
            </span>
            <code className="text-[12px] text-[#d6d1c5]">{path}</code>
            <span className="text-[#8f8c83] max-[720px]:col-start-2">{summary}</span>
          </div>
        ))}
      </div>
      <h2 id="schema" className={heading}>
        OpenAPI schema
      </h2>
      <p className={paragraph}>
        The repository ships the complete OpenAPI document with request bodies, response shapes, and
        validation schemas.
      </p>
      <a
        className="mt-5 inline-flex items-center gap-2 text-[14px] font-medium text-[#ff985f] hover:text-[#ffb187]"
        href={`${repositoryUrl}/blob/main/docs/api/openapi.json`}
      >
        View openapi.json <ArrowRight size={14} />
      </a>
    </>
  )
}

function DocsBody({ page }: { page: DocsPage }) {
  if (page === 'installation') return <InstallationDocs />
  if (page === 'deployments') return <DeploymentDocs />
  if (page === 'api') return <ApiDocs />
  if (page !== 'introduction') return <GuideDocs page={page} />
  return <IntroductionDocs />
}

const fixedPageSections: Partial<Record<DocsPage, { id: string; title: string }[]>> = {
  introduction: [
    { id: 'mental-model', title: 'The mental model' },
    { id: 'what-runs', title: 'What you can run' },
  ],
  installation: [
    { id: 'requirements', title: 'Host requirements' },
    { id: 'prepare', title: 'Prepare the checkout' },
    { id: 'validate', title: 'Validate before provisioning' },
    { id: 'development', title: 'Development without VMs' },
  ],
  deployments: [
    { id: 'source', title: 'Connect source' },
    { id: 'builds', title: 'Configure the build' },
    { id: 'health', title: 'Define health' },
    { id: 'promote', title: 'Deploy and observe' },
  ],
  api: [
    { id: 'authentication', title: 'Authentication' },
    { id: 'conventions', title: 'Request conventions' },
    { id: 'endpoints', title: 'Endpoint index' },
    { id: 'schema', title: 'OpenAPI schema' },
  ],
}

function getPageSections(page: DocsPage) {
  return fixedPageSections[page] ?? guideContent[page]?.sections ?? []
}

export function DocsSite({ page }: { page: DocsPage }) {
  const location = useRouterState({
    select: (state) => ({ hash: state.location.hash, path: state.location.pathname }),
  })
  const [query, setQuery] = useState('')
  const [navOpen, setNavOpen] = useState(false)
  const meta = docsMeta[page]
  const sections = getPageSections(page)
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
  }, [location.path])
  return (
    <div className="min-h-screen bg-[#0b0b09] font-sans text-[#f3f0e8] [color-scheme:dark]">
      <PublicHeader docs />
      <div className="sticky top-[68px] z-40 grid min-h-[57px] grid-cols-[272px_minmax(280px,560px)_1fr] items-center gap-7 border-b border-[#20201c] bg-[#0d0d0bec] px-[max(24px,calc((100vw-1400px)/2))] backdrop-blur-lg max-[720px]:top-[62px] max-[720px]:grid-cols-[auto_1fr] max-[720px]:gap-2.5 max-[720px]:p-2.5 max-[720px]:px-4">
        <button
          className="hidden h-[34px] items-center gap-1.5 rounded-md border border-[#302f29] bg-[#161613] px-2.5 text-[10px] max-[720px]:flex"
          type="button"
          onClick={() => setNavOpen((value) => !value)}
        >
          {navOpen ? <X size={16} /> : <Menu size={16} />}
          {navOpen ? 'Close' : 'Menu'}
        </button>
        <div className="relative flex items-center">
          <Search size={15} className="absolute left-[13px] text-[#65635c]" />
          <input
            className="h-9 w-full rounded-md border border-[#302f29] bg-[#161613] pr-4 pl-[37px] text-[13px]"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search documentation…"
            aria-label="Search documentation"
          />
          {query && (
            <div className="absolute top-[42px] right-0 left-0 grid rounded-md border border-[#37362f] bg-[#161613] shadow-xl">
              {results.length ? (
                results.map((result) => (
                  <Link
                    className="flex min-h-11 items-center justify-between border-b border-[#292822] px-3 text-[13px]"
                    to={result.to}
                    key={result.to}
                  >
                    {result.title}
                    <ArrowRight size={13} />
                  </Link>
                ))
              ) : (
                <span className="p-3 text-[11px]">No matching guides</span>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="mx-auto grid min-h-[calc(100vh-125px)] w-[min(1400px,100%)] grid-cols-[272px_minmax(0,1fr)] max-[720px]:block">
        {navOpen && (
          <button
            aria-label="Close documentation menu"
            className="fixed inset-0 top-[117px] z-44 hidden bg-black/65 backdrop-blur-[2px] max-[720px]:block"
            type="button"
            onClick={() => setNavOpen(false)}
          />
        )}
        <DocsSidebar open={navOpen} path={location.path} />
        <main className="grid grid-cols-[minmax(0,780px)_190px] justify-center gap-[70px] px-[45px] pt-[57px] pb-[110px] max-[1100px]:grid-cols-[minmax(0,760px)] max-[720px]:block max-[720px]:px-[22px] max-[720px]:pt-10">
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
          <aside className="sticky top-[165px] grid h-max gap-1 border-l border-[#292822] pl-5 text-[12px] text-[#77746c] max-[1100px]:hidden">
            <span className="mb-2 font-mono text-[10px] tracking-[.1em] text-[#67645c]">
              ON THIS PAGE
            </span>
            {sections.map((section) => (
              <Link
                className="rounded px-2 py-1.5 hover:bg-[#171713] hover:text-[#d7d2c7]"
                hash={section.id}
                key={section.id}
                to={location.path}
              >
                {section.title}
              </Link>
            ))}
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
        'relative flex min-h-full flex-col border-r border-[#20201c] bg-[#0d0d0b] px-6 py-[30px] max-[720px]:fixed max-[720px]:top-[117px] max-[720px]:bottom-0 max-[720px]:left-0 max-[720px]:z-45 max-[720px]:h-auto max-[720px]:min-h-0 max-[720px]:w-[min(300px,86vw)] max-[720px]:-translate-x-[105%] max-[720px]:overflow-y-auto max-[720px]:transition-transform max-[720px]:[scrollbar-width:none] max-[720px]:[&::-webkit-scrollbar]:hidden',
        open && 'max-[720px]:translate-x-0',
      )}
    >
      <div className="mb-8 flex items-center gap-2">
        <span className="rounded border border-[#4d3022] bg-[#24150e] px-2 py-1 font-mono text-[10px] text-[#ff985f]">
          v0.1
        </span>
        <b className="text-[11px] font-medium text-[#858279]">Development alpha</b>
      </div>
      <nav>
        {docsNavigation.map((group) => (
          <div className="mb-7 grid gap-1" key={group.label}>
            <span className="mb-1.5 font-mono text-[10px] tracking-[.12em] text-[#67645d] uppercase">
              {group.label}
            </span>
            {group.items.map((item) => (
              <Link
                className="-ml-2 flex min-h-9 items-center rounded px-2 py-2 text-[13px] leading-5 text-[#99968d] hover:bg-[#181814] hover:text-[#d6d1c6] data-[active]:bg-[#181814] data-[active]:text-[#eee9dd] data-[active]:shadow-[inset_2px_0_#f07b3e]"
                to={item.to}
                key={item.to}
                data-active={item.to === path ? true : undefined}
              >
                {item.title}
              </Link>
            ))}
          </div>
        ))}
      </nav>
      <div className="mt-auto flex gap-2 rounded-md border border-[#292822] p-4 text-[11px] leading-5 text-[#77746c]">
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
