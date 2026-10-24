import { useEffect, useId, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useParams } from '@tanstack/react-router'
import { Search } from 'lucide-react'
import { cn } from 'cn'
import { api } from './api'
import { Button, Input } from './ui'
interface Result {
  id: string
  kind: 'project' | 'service'
  name: string
  project: string
  project_id: string
  environment: string | null
}
interface Action {
  id: string
  label: string
  keywords: string
  detail?: string
  run: () => void
}
export function CommandMenu() {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const dialog = useRef<HTMLDialogElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const listId = useId()
  const navigate = useNavigate()
  const params = useParams({ strict: false }) as { projectId?: string; serviceId?: string }
  const close = () => {
    setOpen(false)
    setSearch('')
    setSelected(0)
  }
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        setOpen((value) => !value)
        setSearch('')
        setSelected(0)
      }
    }
    document.addEventListener('keydown', listener)
    return () => document.removeEventListener('keydown', listener)
  }, [])
  useEffect(() => {
    if (open) {
      dialog.current?.showModal()
      input.current?.focus()
    } else dialog.current?.close()
  }, [open])
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search), 150)
    return () => clearTimeout(timer)
  }, [search])
  const results = useQuery({
    queryKey: ['search', query],
    queryFn: ({ signal }) =>
      api<{ items: Result[] }>('/search?q=' + encodeURIComponent(query), { signal }),
    enabled: open,
    staleTime: 10000,
  })
  const actions: Action[] = [
    ...(
      [
        ['/', 'Overview', 'home deployments'],
        ['/hosts', 'Hosts', 'infrastructure stats'],
        ['/domains', 'Domains', 'DNS routing'],
        ['/projects', 'Projects', 'workspace home'],
        ['/audit', 'Audit log', 'actions'],
        ['/services/new', 'Add service', 'application database PostgreSQL'],
      ] as const
    ).map(([to, label, keywords]) => ({
      id: to,
      label,
      keywords,
      run: () => {
        void navigate({ to })
      },
    })),
    ...(params.projectId
      ? [
          {
            id: 'settings',
            label: 'Project settings',
            keywords: 'rename',
            run: () => {
              void navigate({
                to: '/projects/$projectId/settings',
                params: { projectId: params.projectId! },
              })
            },
          },
        ]
      : []),
    ...(params.serviceId
      ? ['builds', 'configuration', 'logs', 'metrics', 'secrets', 'activity'].map((tab) => ({
          id: tab,
          label: tab,
          keywords: 'service',
          detail: 'Current service',
          run: () => {
            void navigate({
              to: '/services/$serviceId/' + tab,
              params: { serviceId: params.serviceId! },
            })
          },
        }))
      : []),
    ...(results.data?.items ?? []).map((result) => ({
      id: result.kind + result.id,
      label: result.name,
      keywords: `${result.kind} ${result.project} ${result.environment ?? ''}`,
      detail: result.kind === 'project' ? 'Project' : `${result.project} / ${result.environment}`,
      run: () => {
        if (result.kind === 'project')
          void navigate({ to: '/projects/$projectId', params: { projectId: result.id } })
        else void navigate({ to: '/services/$serviceId', params: { serviceId: result.id } })
      },
    })),
  ].filter((action) =>
    search
      .toLowerCase()
      .trim()
      .split(/\s+/)
      .every((term) => `${action.label} ${action.keywords}`.toLowerCase().includes(term)),
  )
  const active = Math.min(selected, Math.max(0, actions.length - 1))
  const choose = (action?: Action) => {
    if (action) {
      close()
      action.run()
    }
  }
  useEffect(() => {
    dialog.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [active, search])
  return (
    <>
      <Button
        variant="ghost"
        className="min-h-8 gap-2 px-2 py-1"
        aria-label="Open command menu"
        onClick={() => setOpen(true)}
      >
        <Search size={15} />
        <span className="hidden sm:inline">Search</span>
        <kbd className="rounded border border-zinc-700 px-1.5 py-0.5 text-[10px]">⌘ K</kbd>
      </Button>
      <dialog
        ref={dialog}
        aria-label="Command menu"
        onCancel={close}
        onClose={close}
        className="fixed inset-x-0 top-[15vh] m-0 mx-auto w-[calc(100%-2rem)] max-w-xl rounded-xl border border-zinc-700 bg-[light-dark(#f4f4f5,#141416)] p-0 text-zinc-200 shadow-2xl backdrop:bg-black/70"
      >
        <div className="flex items-center gap-3 border-b border-zinc-800 px-4 py-2">
          <Search size={17} aria-hidden="true" />
          <Input
            ref={input}
            role="combobox"
            aria-label="Search commands"
            aria-autocomplete="list"
            aria-expanded={open}
            aria-controls={listId}
            aria-activedescendant={actions.length ? `${listId}-${active}` : undefined}
            value={search}
            onChange={(event) => {
              setSearch(event.target.value)
              setSelected(0)
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault()
                setSelected(
                  (active + (event.key === 'ArrowDown' ? 1 : -1) + actions.length) %
                    Math.max(1, actions.length),
                )
              } else if (event.key === 'Enter') {
                event.preventDefault()
                choose(actions[active])
              } else if (event.key === 'Home') {
                event.preventDefault()
                setSelected(0)
              } else if (event.key === 'End') {
                event.preventDefault()
                setSelected(Math.max(0, actions.length - 1))
              }
            }}
            maxLength={128}
            placeholder="Search projects, services or actions…"
            className="border-0 bg-transparent"
          />
          <Button variant="ghost" aria-label="Close command menu" onClick={close}>
            Esc
          </Button>
        </div>
        {results.error && (
          <p role="alert" className="px-4 py-2 text-sm text-red-300">
            Search unavailable. {results.error.message}
          </p>
        )}
        <div
          id={listId}
          role="listbox"
          aria-label="Commands"
          className="max-h-[55vh] overflow-y-auto p-2"
        >
          {actions.map((action, index) => (
            <button
              key={action.id}
              id={`${listId}-${index}`}
              type="button"
              role="option"
              aria-selected={index === active}
              tabIndex={-1}
              onClick={() => choose(action)}
              className={cn(
                'flex min-h-11 w-full items-center justify-between gap-3 rounded-md px-3 py-3 text-left text-sm text-zinc-300',
                index === active && 'bg-zinc-800 text-white',
              )}
            >
              <span className="truncate capitalize">{action.label}</span>
              <span className="truncate text-xs text-zinc-400">{action.detail}</span>
            </button>
          ))}
        </div>
        {!actions.length && (
          <p role="status" className="p-6 text-center text-sm text-zinc-400">
            {results.isFetching ? 'Searching…' : 'No matching commands.'}
          </p>
        )}
        <p className="border-t border-zinc-800 px-4 py-3 text-xs text-zinc-400">
          ↑ ↓ to navigate · Enter to open · Esc to close
        </p>
      </dialog>
    </>
  )
}
