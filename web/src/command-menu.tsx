import { useEffect, useState } from 'react'
import { Command } from 'cmdk'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useParams } from '@tanstack/react-router'
import { Box, Layers3, Plus, Search, Settings, ShieldCheck } from 'lucide-react'
import { cn } from 'cn'
import { api } from './api'
import { Button } from './ui'
interface Result {
  id: string
  kind: 'project' | 'service'
  name: string
  project: string
  project_id: string
  environment: string | null
}
const item =
  'flex cursor-pointer items-center gap-3 rounded-md px-3 py-3 text-sm text-zinc-300 outline-none data-[selected=true]:bg-zinc-800 data-[selected=true]:text-white'
export function CommandMenu() {
  const [open, setOpen] = useState(false),
    [search, setSearch] = useState(''),
    [query, setQuery] = useState('')
  const navigate = useNavigate(),
    params = useParams({ strict: false }) as { projectId?: string; serviceId?: string }
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        setOpen((value) => !value)
      }
    }
    document.addEventListener('keydown', listener)
    return () => document.removeEventListener('keydown', listener)
  }, [])
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
  const close = () => {
    setOpen(false)
    setSearch('')
  }
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
      <Command.Dialog
        open={open}
        onOpenChange={(value) => {
          setOpen(value)
          if (!value) setSearch('')
        }}
        label="Command menu"
        aria-describedby={undefined}
        className="rounded-xl border border-zinc-700 bg-[#141416] text-zinc-200 shadow-2xl"
        loop
      >
        <div className="flex items-center gap-3 border-b border-zinc-800 px-4">
          <Search size={17} className="text-zinc-500" />
          <Command.Input
            value={search}
            onValueChange={setSearch}
            maxLength={128}
            placeholder="Search projects, services or actions…"
            aria-label="Search commands"
            className="h-14 w-full border-0 bg-transparent text-sm outline-none placeholder:text-zinc-500"
          />
          <kbd className="text-[10px] text-zinc-500">Esc</kbd>
        </div>
        <Command.List className="max-h-[55vh] overflow-y-auto p-2" aria-label="Commands">
          <Command.Empty className="p-8 text-center text-sm text-zinc-500">
            {results.isFetching ? 'Searching…' : 'No matching commands.'}
          </Command.Empty>
          <Command.Group heading="Navigate" className="command-group">
            {(
              [
                { to: '/', label: 'Overview home deployments' },
                { to: '/hosts', label: 'Hosts infrastructure stats' },
                { to: '/domains', label: 'Domains DNS routing' },
              ] as const
            ).map(({ to, label }) => (
              <Command.Item
                key={to}
                className={item}
                value={label}
                onSelect={() => {
                  close()
                  void navigate({ to })
                }}
              >
                <Layers3 size={16} />
                {to === '/' ? 'Overview' : to === '/hosts' ? 'Hosts' : 'Domains'}
              </Command.Item>
            ))}
            <Command.Item
              className={item}
              value="Projects workspace home"
              onSelect={() => {
                close()
                void navigate({ to: '/projects' })
              }}
            >
              <Layers3 size={16} />
              Projects
            </Command.Item>
            <Command.Item
              className={item}
              value="Audit log actions"
              onSelect={() => {
                close()
                void navigate({ to: '/audit' })
              }}
            >
              <ShieldCheck size={16} />
              Audit log
            </Command.Item>
            <Command.Item
              className={item}
              value="Add service application database PostgreSQL"
              onSelect={() => {
                close()
                void navigate({ to: '/services/new' })
              }}
            >
              <Plus size={16} />
              Add service
            </Command.Item>
            {params.projectId && (
              <Command.Item
                className={item}
                value="Project settings rename"
                onSelect={() => {
                  close()
                  void navigate({
                    to: '/projects/$projectId/settings',
                    params: { projectId: params.projectId! },
                  })
                }}
              >
                <Settings size={16} />
                Project settings
              </Command.Item>
            )}
            {params.serviceId &&
              ['builds', 'configuration', 'logs', 'metrics', 'secrets', 'activity'].map((tab) => (
                <Command.Item
                  key={tab}
                  className={item}
                  value={'Service ' + tab}
                  onSelect={() => {
                    close()
                    void navigate({
                      to: '/services/$serviceId/' + tab,
                      params: { serviceId: params.serviceId! },
                    })
                  }}
                >
                  <Box size={16} />
                  <span className="capitalize">{tab}</span>
                  <span className="ml-auto text-xs text-zinc-500">Current service</span>
                </Command.Item>
              ))}
          </Command.Group>
          {results.error && (
            <p role="alert" className="px-3 py-2 text-xs text-red-300">
              Search unavailable. {results.error.message}
            </p>
          )}
          <Command.Group heading="Projects and services" className="command-group">
            {results.data?.items.map((result) => (
              <Command.Item
                key={result.kind + result.id}
                value={
                  result.kind +
                  ' ' +
                  result.name +
                  ' ' +
                  result.project +
                  ' ' +
                  (result.environment ?? '')
                }
                className={cn(item, 'justify-between')}
                onSelect={() => {
                  close()
                  if (result.kind === 'project')
                    void navigate({ to: '/projects/$projectId', params: { projectId: result.id } })
                  else
                    void navigate({ to: '/services/$serviceId', params: { serviceId: result.id } })
                }}
              >
                <span className="flex min-w-0 items-center gap-3">
                  {result.kind === 'project' ? <Layers3 size={16} /> : <Box size={16} />}
                  <span className="truncate">{result.name}</span>
                </span>
                <span className="truncate text-xs text-zinc-500">
                  {result.kind === 'project'
                    ? 'Project'
                    : result.project + ' / ' + result.environment}
                </span>
              </Command.Item>
            ))}
          </Command.Group>
        </Command.List>
        <div className="border-t border-zinc-800 px-4 py-3 text-[11px] text-zinc-500">
          ↑ ↓ to navigate · Enter to open · Esc to close
        </div>
      </Command.Dialog>
    </>
  )
}
