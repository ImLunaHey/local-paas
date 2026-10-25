import { Link, useRouterState } from '@tanstack/react-router'
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  ChevronRight,
  Code2,
  Database,
  GitBranch,
  Layers3,
  Menu,
  Search,
  ShieldCheck,
  Terminal,
  X,
} from 'lucide-react'
import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from 'cn'
import { Button } from './components/button'
import { Input } from './components/input'
import {
  docs,
  groups,
  headingId,
  navigationTitle,
  searchDocs,
  sections,
  type Doc,
} from './features/docs/content'
import { CodeBlock } from './features/docs/code-block'
import { ServiceExample, DeploymentExample } from './features/docs/examples'
import { ApiWorkbench } from './features/docs/api-explorer'

const repository = 'https://github.com/ImLunaHey/local-paas'
const surface =
  'min-h-screen bg-[#0b0b0e] font-sans text-[#ededf0] antialiased [color-scheme:dark] selection:bg-[#ff9a6233]'
const action =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-[#efefef] px-5 text-sm font-medium text-[#18181b] transition-colors hover:bg-[#fff]'
function DocLink({
  slug,
  children,
  className,
  onClick,
}: {
  slug: string
  children: ReactNode
  className?: string
  onClick?: () => void
}) {
  return slug ? (
    <Link
      to="/docs/$slug"
      params={{ slug }}
      activeOptions={{ exact: true }}
      className={className}
      onClick={onClick}
    >
      {children}
    </Link>
  ) : (
    <Link to="/docs" activeOptions={{ exact: true }} className={className} onClick={onClick}>
      {children}
    </Link>
  )
}
function Brand() {
  return (
    <Link
      to="/"
      aria-label="local paas home"
      className="inline-flex shrink-0 items-center gap-2.5 text-lg font-semibold tracking-tight"
    >
      <span className="grid size-8 place-items-center rounded-lg border border-[#37373d] bg-[#1a1a20]">
        <Layers3 size={19} className="text-[#f5af85]" />
      </span>
      local<span className="-mx-1 text-[#787884]">/</span>paas
    </Link>
  )
}
function PublicHeader({ docsMode = false }: { docsMode?: boolean }) {
  return (
    <header className="sticky top-0 z-40 h-17 border-b border-[#27272d] bg-[#0b0b0ef2] backdrop-blur-xl">
      <div
        className={cn(
          'mx-auto flex h-full items-center gap-6 px-5 lg:px-8',
          docsMode ? 'max-w-[1480px]' : 'max-w-6xl',
        )}
      >
        <Brand />
        <span className="hidden h-5 w-px bg-[#34343a] sm:block" />
        <Link to="/docs" className="hidden text-sm text-[#c4c4cc] hover:text-[#fff] sm:block">
          Documentation
        </Link>
        <div className="ml-auto flex items-center gap-5">
          <a href={repository} className="hidden text-sm text-[#aaaab5] hover:text-[#fff] md:block">
            GitHub
          </a>
          <Link
            to="/app"
            className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-[#35353d] bg-[#19191e] px-3 text-sm text-[#e4e4e7] hover:bg-[#25252b]"
          >
            Dashboard
            <ArrowRight size={14} />
          </Link>
        </div>
      </div>
    </header>
  )
}

export function MarketingHome() {
  useEffect(() => {
    document.title = 'local/paas — From source to something live'
  }, [])
  return (
    <div className={surface}>
      <PublicHeader />
      <main>
        <section className="relative overflow-hidden border-b border-[#27272d]">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_75%_45%,#643d2529,transparent_60%)]"
          />
          <div className="relative mx-auto grid max-w-6xl items-center gap-14 px-6 py-20 lg:grid-cols-[1fr_1.05fr] lg:gap-12 lg:px-8 lg:py-32">
            <div>
              <span className="inline-flex items-center gap-2 rounded-full border border-[#40352d] bg-[#221a15] px-3 py-1.5 text-xs text-[#e7b393]">
                <span className="size-1.5 rounded-full bg-[#f0ad80]" />A smaller cloud. A complete
                workflow.
              </span>
              <h1 className="mt-7 text-5xl leading-[1.06] font-semibold tracking-[-.055em] sm:text-6xl lg:text-[68px]">
                From source to
                <br />
                <span className="text-[#edb28e]">something live.</span>
              </h1>
              <p className="mt-6 max-w-lg text-lg leading-8 text-[#a7a7b2]">
                A home for your applications, databases, and background work. Build from your code,
                deploy with confidence, and see what happens next.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <DocLink slug="deployments" className={action}>
                  Deploy your first app
                  <ArrowRight size={16} />
                </DocLink>
                <Link
                  to="/docs"
                  className="inline-flex min-h-11 items-center gap-2 px-4 text-sm text-[#c6c6ce] hover:text-[#fff]"
                >
                  Explore the docs
                  <BookOpen size={16} />
                </Link>
              </div>
              <p className="mt-5 text-xs leading-6 text-[#92929e]">
                Private alpha · Use your team's existing workspace
              </p>
            </div>
            <div>
              <p className="mb-3 px-1 text-xs text-[#92929e]">
                One workflow, from commit to healthy service
              </p>
              <DeploymentExample compact />
              <div className="mt-4 grid grid-cols-3 gap-3">
                {[
                  ['Runtime', 'Node.js'],
                  ['Data', 'PostgreSQL'],
                  ['Source', 'Git or upload'],
                ].map(([label, value]) => (
                  <div
                    key={label}
                    className="rounded-lg border border-[#2b2b31] bg-[#111114] px-4 py-3"
                  >
                    <p className="text-xs text-[#92929e]">{label}</p>
                    <p className="mt-1.5 text-sm font-medium">{value}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-8 gap-y-4 border-b border-[#27272d] px-6 py-7 text-sm text-[#a1a1ad] lg:px-8">
          <span className="text-xs text-[#787885]">BRING THE CODE YOU KNOW</span>
          {['Node.js', 'Python', 'Go', 'Rust', 'Bun', 'Ruby', 'PHP', 'Docker'].map((name) => (
            <span key={name}>{name}</span>
          ))}
        </div>
        <section className="mx-auto max-w-6xl px-6 py-20 lg:px-8 lg:py-24">
          <div className="max-w-2xl">
            <p className="text-sm font-medium text-[#e5aa85]">
              Less between you and your next release
            </p>
            <h2 className="mt-4 text-3xl leading-tight font-semibold tracking-[-.035em] sm:text-4xl">
              The tools your app needs.
              <br />
              In the place you already work.
            </h2>
            <p className="mt-5 text-base leading-8 text-[#a1a1ad]">
              Move from building to running without stitching together a different workflow for
              every part of your application.
            </p>
          </div>
          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {[
              {
                Icon: GitBranch,
                title: 'Source in. Service out.',
                body: 'Build a pinned Git revision or upload your source. Use a generated language recipe or bring your own Dockerfile.',
                slug: 'builds',
              },
              {
                Icon: ShieldCheck,
                title: 'Ready before it is live.',
                body: 'Candidates pass readiness before traffic moves. Inspect deployment history and return to a retained healthy revision.',
                slug: 'health-checks',
              },
              {
                Icon: Database,
                title: 'Give your app its data.',
                body: 'Connect PostgreSQL, Redis, and object storage. Keep credentials in secret bindings, not scattered through your code.',
                slug: 'storage',
              },
              {
                Icon: Terminal,
                title: 'See what is happening.',
                body: 'Follow build output, filter runtime logs, and inspect resource measurements without leaving the service.',
                slug: 'observability',
              },
              {
                Icon: Layers3,
                title: 'Room to experiment.',
                body: 'Separate environments, deliberate configuration inheritance, and opt-in pull-request previews keep changes organized.',
                slug: 'environments',
              },
              {
                Icon: Code2,
                title: 'Make it programmable.',
                body: 'Explore the API, mint a scoped personal key, and test a request directly in the documentation.',
                slug: 'api',
              },
            ].map(({ Icon, title, body, slug }) => (
              <DocLink
                key={slug}
                slug={slug}
                className="group rounded-xl border border-[#2b2b32] bg-[#111114] p-6 transition-colors hover:border-[#595047] hover:bg-[#16161a]"
              >
                <Icon size={22} className="text-[#d7ad91]" />
                <h3 className="mt-6 text-lg font-medium tracking-tight">{title}</h3>
                <p className="mt-3 text-sm leading-7 text-[#a1a1ad]">{body}</p>
                <span className="mt-6 flex items-center gap-2 text-xs text-[#d3d3da]">
                  Learn more
                  <ArrowRight
                    size={14}
                    className="transition-transform group-hover:translate-x-1"
                  />
                </span>
              </DocLink>
            ))}
          </div>
        </section>
        <section className="border-y border-[#27272d] bg-[#101014]">
          <div className="mx-auto grid max-w-6xl items-center gap-10 px-6 py-16 lg:grid-cols-2 lg:px-8">
            <div>
              <p className="text-sm text-[#e5aa85]">A good first deployment starts here</p>
              <h2 className="mt-4 text-3xl font-semibold tracking-tight">
                Real guides.
                <br />
                All the way to running.
              </h2>
              <p className="mt-5 text-base leading-8 text-[#a1a1ad]">
                Complete examples, the settings that matter, and help when a build or health check
                fails. Start with a language you know.
              </p>
              <Link
                to="/docs"
                className="mt-6 inline-flex items-center gap-2 text-sm text-[#eeeef2]"
              >
                Read the documentation
                <ArrowRight size={16} />
              </Link>
            </div>
            <div className="grid gap-3">
              {[
                [
                  'nodejs',
                  'Deploy Node.js',
                  'A complete HTTP app, from package.json to readiness.',
                ],
                ['python', 'Deploy Python', 'FastAPI, uv, and a production start command.'],
                ['dockerfile', 'Bring a Dockerfile', 'Own the build and runtime contract.'],
              ].map(([slug, title, description]) => (
                <DocLink
                  key={slug}
                  slug={slug}
                  className="flex items-center gap-4 rounded-xl border border-[#323239] bg-[#15151a] p-5 hover:border-[#66616a]"
                >
                  <Code2 size={21} className="shrink-0 text-[#c3a28d]" />
                  <div>
                    <h3 className="text-sm font-medium">{title}</h3>
                    <p className="mt-1 text-sm leading-6 text-[#9999a6]">{description}</p>
                  </div>
                  <ChevronRight size={18} className="ml-auto shrink-0" />
                </DocLink>
              ))}
            </div>
          </div>
        </section>
        <section className="mx-auto max-w-3xl px-6 py-20 text-center">
          <h2 className="text-3xl font-semibold tracking-tight">
            Your next app starts with a commit.
          </h2>
          <p className="mt-5 text-base leading-8 text-[#a1a1ad]">
            Already have workspace access? Open the dashboard and build something. New here? Start
            with the deployment guide.
          </p>
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            <Link to="/app" className={action}>
              Open your workspace
              <ArrowRight size={16} />
            </Link>
            <DocLink slug="deployments" className="inline-flex min-h-11 items-center px-4 text-sm">
              Read the guide
            </DocLink>
          </div>
          <p className="mt-7 text-xs leading-6 text-[#92929e]">
            local/paas is an experimental private platform. Availability, capacity, and public
            routing depend on your workspace. No hosted signup or uptime guarantee is implied.
          </p>
        </section>
      </main>
      <footer className="border-t border-[#27272d]">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-6 px-6 py-9 lg:px-8">
          <Brand />
          <nav aria-label="Footer" className="flex flex-wrap gap-6 text-sm text-[#a1a1ad]">
            <Link to="/docs">Documentation</Link>
            <DocLink slug="api">API</DocLink>
            <a href={repository}>GitHub</a>
            <a href={`${repository}/blob/main/LICENSE`}>MIT License</a>
          </nav>
        </div>
      </footer>
    </div>
  )
}

function Navigation({ slug, onNavigate }: { slug: string; onNavigate?: () => void }) {
  return (
    <nav aria-label="Documentation" className="space-y-7">
      {groups.map((group) => (
        <div key={group}>
          <h2 className="mb-2 px-3 text-xs font-semibold text-[#e0e0e7]">{group}</h2>
          <ul className="space-y-0.5">
            {docs
              .filter((doc) => doc.group === group)
              .map((doc) => (
                <li key={doc.slug}>
                  <DocLink
                    slug={doc.slug}
                    onClick={onNavigate}
                    className={cn(
                      'relative block rounded-md px-3 py-2 text-sm leading-5 transition-colors',
                      slug === doc.slug
                        ? 'bg-[#23201e] font-medium text-[#f1bd98]'
                        : 'text-[#a4a4b0] hover:bg-[#1a1a20] hover:text-[#eeeef2]',
                    )}
                  >
                    {navigationTitle(doc)}
                  </DocLink>
                </li>
              ))}
          </ul>
        </div>
      ))}
    </nav>
  )
}

function DocsSearch() {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const container = useRef<HTMLDivElement>(null)
  const results = searchDocs(query)
  const path = useRouterState({ select: (state) => state.location.pathname })
  useEffect(() => {
    setOpen(false)
    setQuery('')
  }, [path])
  useEffect(() => {
    function keydown(event: globalThis.KeyboardEvent) {
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key === 'k' &&
        input.current?.getBoundingClientRect().width
      ) {
        event.preventDefault()
        input.current.focus()
        setOpen(true)
      }
    }
    document.addEventListener('keydown', keydown)
    return () => document.removeEventListener('keydown', keydown)
  }, [])
  function handleSearchKey(e: KeyboardEvent<HTMLElement>) {
    if (e.key === 'Escape') {
      setOpen(false)
      input.current?.focus()
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const links = Array.from(
        container.current?.querySelectorAll<HTMLAnchorElement>('[data-search-result]') ?? [],
      )
      if (!links.length) return
      e.preventDefault()
      const index = links.indexOf(document.activeElement as HTMLAnchorElement)
      links[(index + (e.key === 'ArrowDown' ? 1 : -1) + links.length) % links.length]?.focus()
    }
  }
  return (
    <div
      ref={container}
      className="relative w-full"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false)
      }}
    >
      <Search size={15} className="pointer-events-none absolute top-3.5 left-3 text-[#9999a5]" />
      <Input
        ref={input}
        className="min-h-11 border-[#33333c] bg-[#141419] pr-9 pl-9 text-sm"
        placeholder="Search documentation…"
        onKeyDown={handleSearchKey}
        aria-label="Search documentation"
        value={query}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
        }}
      />
      <kbd className="pointer-events-none absolute top-3.5 right-3 hidden text-xs text-[#9999a5] sm:block">
        ⌘K
      </kbd>
      {open && query && (
        <div className="absolute top-13 right-0 left-0 z-50 max-h-96 overflow-y-auto rounded-xl border border-[#3c3c45] bg-[#17171d] p-2 shadow-2xl">
          <p className="px-3 py-2 text-xs text-[#9e9eab]" role="status">
            {results.length
              ? `${results.length} matching guides`
              : 'No matching guides. Try a language, feature, or error.'}
          </p>
          {results.map((result) => (
            <Link
              onKeyDown={handleSearchKey}
              data-search-result
              key={result.slug}
              to={result.slug ? '/docs/$slug' : '/docs'}
              params={{ slug: result.slug }}
              className="block rounded-lg px-3 py-3 hover:bg-[#27272f] focus:bg-[#27272f]"
            >
              <p className="text-sm font-medium">{result.title}</p>
              <p className="mt-1 line-clamp-2 text-xs leading-5 text-[#aaaab6]">
                {result.description}
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

const markdownComponents: Components = {
  h2: ({ children }) => (
    <h2
      id={headingId(String(children))}
      className="mt-12 mb-5 scroll-mt-40 text-2xl leading-8 font-semibold tracking-[-.025em] text-[#efeff3] lg:scroll-mt-24"
    >
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="mt-8 mb-3 text-lg font-medium text-[#efeff3]">{children}</h3>
  ),
  p: ({ children }) => <p className="my-5 text-[15px] leading-7 text-[#b0b0bc]">{children}</p>,
  a: ({ href, children }) =>
    href?.startsWith('/docs') ? (
      <DocLink
        slug={href.replace(/^\/docs\/?/, '')}
        className="text-[#edb28e] underline decoration-[#766054] underline-offset-4 hover:decoration-current"
      >
        {children}
      </DocLink>
    ) : (
      <a href={href} className="text-[#edb28e] underline underline-offset-4">
        {children}
      </a>
    ),
  strong: ({ children }) => <strong className="font-semibold text-[#e3e3e9]">{children}</strong>,
  ul: ({ children }) => (
    <ul className="my-5 list-disc space-y-3 pl-5 text-[15px] leading-7 text-[#b0b0bc] marker:text-[#827468]">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="my-5 list-decimal space-y-3 pl-5 text-[15px] leading-7 text-[#b0b0bc] marker:text-[#e1ad89]">
      {children}
    </ol>
  ),
  pre: ({ children }) => <>{children}</>,
  code: ({ className, children }) => {
    const language = /language-(\w+)/.exec(className ?? '')?.[1]
    return language ? (
      <CodeBlock language={language} code={String(children)} />
    ) : (
      <code className="rounded border border-[#313139] bg-[#1a1a20] px-1.5 py-0.5 font-mono text-[.85em] text-[#e4c5b0]">
        {children}
      </code>
    )
  },
  blockquote: ({ children }) => (
    <blockquote className="my-6 rounded-r-lg border-l-2 border-[#ba8c6a] bg-[#221b17] px-5 py-1">
      {children}
    </blockquote>
  ),
  table: ({ children }) => (
    <div className="my-6 overflow-x-auto">
      <table className="w-full text-left text-sm">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border-b border-[#33333c] p-3">{children}</th>,
  td: ({ children }) => (
    <td className="border-b border-[#29292f] p-3 text-[#b0b0bc]">{children}</td>
  ),
}
function Article({ doc }: { doc: Doc }) {
  return (
    <Markdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
      {doc.body}
    </Markdown>
  )
}

export function DocsSite({ page }: { page: string }) {
  const slug = page === 'introduction' ? '' : page === 'health' ? 'health-checks' : page
  const doc = docs.find((item) => item.slug === slug)
  const [active, setActive] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const dialog = useRef<HTMLDialogElement>(null)
  const title = useRef<HTMLHeadingElement>(null)
  const toc = doc ? sections(doc) : []
  useEffect(() => {
    document.title = doc ? `${doc.title} · local/paas docs` : 'Page not found · local/paas docs'
    title.current?.focus({ preventScroll: true })
    setMenuOpen(false)
    dialog.current?.close()
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        if (visible[0]) setActive(visible[0].target.id)
      },
      { rootMargin: '-90px 0px -65% 0px' },
    )
    document.querySelectorAll('article h2[id]').forEach((element) => observer.observe(element))
    return () => observer.disconnect()
  }, [doc])
  function closeMenu() {
    dialog.current?.close()
    setMenuOpen(false)
  }
  function openMenu() {
    dialog.current?.showModal()
    setMenuOpen(true)
  }
  const index = doc ? docs.indexOf(doc) : -1
  const previous = docs[index - 1]
  const next = docs[index + 1]
  return (
    <div className={surface}>
      <a
        href="#docs-content"
        className="fixed top-2 left-2 z-60 -translate-y-20 rounded bg-[#eee] p-3 text-sm text-[#111] focus:translate-y-0"
      >
        Skip to content
      </a>
      <PublicHeader docsMode />
      <div className="sticky top-17 z-30 flex items-center gap-3 border-b border-[#29292f] bg-[#0b0b0e] px-5 py-3 lg:hidden">
        <Button aria-label="Open documentation menu" aria-expanded={menuOpen} onClick={openMenu}>
          <Menu size={18} />
        </Button>
        <DocsSearch />
      </div>
      <div className="mx-auto grid max-w-[1480px] lg:grid-cols-[250px_minmax(0,1fr)] xl:grid-cols-[260px_minmax(0,1fr)_200px]">
        <aside className="sticky top-17 hidden h-[calc(100dvh-4.25rem)] overflow-y-auto border-r border-[#24242b] px-5 py-7 [scrollbar-width:none] lg:block [&::-webkit-scrollbar]:hidden">
          <DocsSearch />
          <div className="mt-8">
            <Navigation slug={slug} />
          </div>
          <a
            href={repository}
            className="mt-9 flex items-center gap-2 border-t border-[#29292f] px-3 pt-5 text-xs text-[#9999a6]"
          >
            <Code2 size={14} />
            Open source on GitHub
          </a>
        </aside>
        <dialog
          ref={dialog}
          aria-label="Documentation menu"
          onClose={() => setMenuOpen(false)}
          className="fixed inset-y-0 left-0 m-0 h-dvh max-h-none w-[min(340px,90vw)] max-w-none border-r border-[#36363d] bg-[#111115] p-5 text-[#ededf0] backdrop:bg-black/70"
        >
          <div className="mb-7 flex items-center justify-between">
            <Brand />
            <Button aria-label="Close documentation menu" onClick={closeMenu}>
              <X size={18} />
            </Button>
          </div>
          <div className="h-[calc(100dvh-110px)] overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <Navigation slug={slug} onNavigate={closeMenu} />
          </div>
        </dialog>
        <main id="docs-content" className="min-w-0 px-6 py-9 sm:px-10 lg:py-12 xl:px-12">
          {doc ? (
            <article className="mx-auto max-w-[760px]">
              <div className="mb-6 flex items-center gap-2 text-xs text-[#9999a5]">
                <Link to="/docs">Docs</Link>
                <ChevronRight size={12} />
                <span>{doc.group}</span>
              </div>
              <h1
                ref={title}
                tabIndex={-1}
                className="text-4xl leading-[1.15] font-semibold tracking-[-.045em] outline-none sm:text-[42px]"
              >
                {doc.title}
              </h1>
              <p className="mt-5 max-w-2xl text-lg leading-8 text-[#a6a6b3]">{doc.description}</p>
              {slug === '' && (
                <div className="mt-8 grid gap-3 sm:grid-cols-2">
                  {[
                    ['nodejs', 'Deploy an app', 'Start with a complete Node.js example.'],
                    ['api', 'Build with the API', 'Explore, authenticate, and send a request.'],
                  ].map(([target, label, description]) => (
                    <DocLink
                      key={target}
                      slug={target}
                      className="rounded-xl border border-[#363038] bg-[#171419] p-5 hover:border-[#8a6c55]"
                    >
                      <span className="flex items-center justify-between text-sm font-medium">
                        {label}
                        <ArrowRight size={16} className="text-[#e7b08c]" />
                      </span>
                      <span className="mt-2 block text-sm leading-6 text-[#a1a1ad]">
                        {description}
                      </span>
                    </DocLink>
                  ))}
                </div>
              )}
              {doc.example === 'service' && <ServiceExample />}
              {doc.example === 'deployment' && <DeploymentExample />}
              <Article doc={doc} />
              {(slug === 'api' || slug === 'api-keys') && (
                <ApiWorkbench keysOnly={slug === 'api-keys'} />
              )}
              {doc.related && (
                <section className="mt-12 border-t border-[#2a2a31] pt-7">
                  <h2 className="text-sm font-medium">Continue exploring</h2>
                  <div className="mt-4 flex flex-wrap gap-3">
                    {doc.related.map((target) => (
                      <DocLink
                        key={target}
                        slug={target}
                        className="inline-flex items-center gap-2 rounded-lg border border-[#303038] px-3 py-2.5 text-sm text-[#b8b8c4] hover:bg-[#1a1a21]"
                      >
                        {docs.find((d) => d.slug === target)?.title}
                        <ArrowRight size={14} />
                      </DocLink>
                    ))}
                  </div>
                </section>
              )}
              <nav
                aria-label="Adjacent pages"
                className="mt-10 grid grid-cols-2 gap-4 border-t border-[#29292f] pt-6 pb-10"
              >
                {previous ? (
                  <DocLink
                    slug={previous.slug}
                    className="rounded-lg border border-[#303037] p-4 hover:bg-[#17171d]"
                  >
                    <span className="flex items-center gap-2 text-xs text-[#92929f]">
                      <ArrowLeft size={12} />
                      Previous
                    </span>
                    <span className="mt-2 block text-sm">{previous.title}</span>
                  </DocLink>
                ) : (
                  <span />
                )}
                {next && (
                  <DocLink
                    slug={next.slug}
                    className="rounded-lg border border-[#303037] p-4 text-right hover:bg-[#17171d]"
                  >
                    <span className="flex items-center justify-end gap-2 text-xs text-[#92929f]">
                      Next
                      <ArrowRight size={12} />
                    </span>
                    <span className="mt-2 block text-sm">{next.title}</span>
                  </DocLink>
                )}
              </nav>
            </article>
          ) : (
            <div className="py-12">
              <h1 className="text-3xl font-semibold">Page not found</h1>
              <p className="my-5 text-[#a1a1ad]">
                This is not a customer documentation page. Choose a guide from the navigation.
              </p>
              <Link to="/docs" className={action}>
                Back to documentation
                <ArrowRight size={16} />
              </Link>
            </div>
          )}
        </main>
        <aside className="sticky top-17 hidden h-[calc(100dvh-4.25rem)] overflow-y-auto py-12 pr-6 text-xs [scrollbar-width:none] xl:block [&::-webkit-scrollbar]:hidden">
          <p className="mb-4 font-medium text-[#d9d9e2]">On this page</p>
          <nav aria-label="On this page" className="space-y-1 border-l border-[#303038]">
            {toc.map((section) => (
              <Link
                key={section.id}
                to={slug ? '/docs/$slug' : '/docs'}
                params={{ slug }}
                hash={section.id}
                aria-current={active === section.id ? 'location' : undefined}
                className={cn(
                  '-ml-px block border-l px-4 py-2 leading-5',
                  active === section.id
                    ? 'border-[#e4ad87] text-[#f0be9b]'
                    : 'border-transparent text-[#9696a3] hover:text-[#dddde5]',
                )}
              >
                {section.title}
              </Link>
            ))}
          </nav>
          <div className="mt-8 border-t border-[#29292f] pt-5 text-[#92929f]">
            <p className="flex items-center gap-2">
              <Check size={13} />
              Private alpha
            </p>
            <p className="mt-2 leading-6">Guides for your team's workspace.</p>
          </div>
        </aside>
      </div>
    </div>
  )
}
