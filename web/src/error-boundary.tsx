import { Component, type ReactNode, useState } from 'react'
import { useQueryClient, useQueryErrorResetBoundary } from '@tanstack/react-query'
import { Link, useLocation, useRouter, type ErrorComponentProps } from '@tanstack/react-router'
import { AlertCircle, RotateCcw } from 'lucide-react'
import { Button } from './components/button'

type Scope = 'page' | 'tab'
function Failure({ scope, retry }: { scope: Scope; retry: () => void | Promise<void> }) {
  const [busy, setBusy] = useState(false)
  return (
    <section
      role="alert"
      className="panel min-w-0 p-6 sm:p-8 [background:light-dark(#f4f4f5,_#131315)] [border:1px_solid_light-dark(#e4e4e7,_#28282c)] [border-radius:8px] [box-shadow:0_1px_0_#ffffff04_inset,_0_8px_24px_#0000000d]"
    >
      <div className="mb-4 flex size-10 items-center justify-center rounded-lg border border-red-400/20 bg-red-400/10 text-red-300">
        <AlertCircle size={20} />
      </div>
      <h2 className="text-base">This {scope} couldn’t be displayed</h2>
      <p className="mt-2 max-w-lg text-sm leading-relaxed text-muted">
        Something went wrong while displaying this {scope}. Try again, or use the navigation to open
        another {scope}.
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        <Button
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            try {
              await retry()
            } catch {
              /* Keep recovery available if refreshing fails. */
            } finally {
              setBusy(false)
            }
          }}
        >
          <RotateCcw size={14} />
          {busy ? 'Retrying…' : 'Try again'}
        </Button>
        <Link
          to="/projects"
          className="button secondary [display:inline-flex] [align-items:center] [justify-content:center] [gap:8px] [font-size:11px] [font-weight:600] [line-height:1] [white-space:nowrap] [border:1px_solid_transparent] [border-radius:6px] [padding:12px_15px] [&.primary]:[background:#ff8a4c] [&.primary]:[color:#1b100a] [&.primary]:[border-color:#ff8a4c] [&.primary:hover]:[background:#ffa36c] [&.secondary]:[background:light-dark(#e4e4e7,_#1b1b1e)] [&.secondary]:[border-color:light-dark(#d4d4d8,_#38383c)] [&.secondary]:[color:light-dark(#27272a,_#e7e7eb)] [&.secondary:hover]:[background:light-dark(#e4e4e7,_#1b1b1e)]"
        >
          View projects
        </Link>
      </div>
    </section>
  )
}

class Boundary extends Component<
  { children: ReactNode; scope: Scope; recover: () => Promise<void> },
  { failed: boolean }
> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? (
      <Failure
        scope={this.props.scope}
        retry={async () => {
          await this.props.recover()
          this.setState({ failed: false })
        }}
      />
    ) : (
      this.props.children
    )
  }
}

export function ContentBoundary({
  children,
  scope = 'page',
}: {
  children: ReactNode
  scope?: Scope
}) {
  const pathname = useLocation({ select: (location) => location.pathname })
  const client = useQueryClient()
  const { reset } = useQueryErrorResetBoundary()
  return (
    <Boundary
      key={pathname}
      scope={scope}
      recover={async () => {
        reset()
        await client.resetQueries()
      }}
    >
      {children}
    </Boundary>
  )
}

// Router loaders and route render errors are caught inside Outlet, before the
// enclosing React boundary. Give those the same recovery UI at their own route.
export function RouteError({ reset }: ErrorComponentProps) {
  const pathname = useLocation({ select: (location) => location.pathname })
  const router = useRouter()
  const client = useQueryClient()
  const queryErrors = useQueryErrorResetBoundary()
  const scope = pathname.startsWith('/services/') && pathname.split('/').length > 3 ? 'tab' : 'page'
  return (
    <Failure
      scope={scope}
      retry={async () => {
        queryErrors.reset()
        await client.resetQueries()
        await router.invalidate()
        reset()
      }}
    />
  )
}
