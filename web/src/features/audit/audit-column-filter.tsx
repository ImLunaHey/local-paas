import { ChevronDown } from 'lucide-react'
import { cn } from 'cn'

import { Input } from '../../components/input'
import { Select } from '../../components/select'

interface Filters {
  project: string
  environment: string
  action: string
  actor: string
  outcome: string
  from: string
  until: string
}
const compact = 'min-h-8 h-8 rounded px-2 py-1 text-[11px] font-normal'
export function AuditColumnFilter({
  id,
  draft,
  set,
  projects,
  environments,
}: {
  id: string
  draft: Filters
  set: (key: keyof Filters, value: string) => void
  projects: { data?: { items: { id: string; name: string }[] } }
  environments: { data?: { environments: { id: string; name: string }[] } }
}) {
  switch (id) {
    case 'timestamp':
      return (
        <details className="relative font-normal">
          <summary
            className={cn(
              'flex min-h-8 cursor-pointer list-none items-center rounded border border-zinc-700 px-2 text-[11px] text-zinc-400 hover:text-zinc-200',
              (draft.from || draft.until) && 'border-orange-400/40 text-orange-300',
            )}
          >
            {draft.from || draft.until ? 'Date range selected' : 'Any time'}{' '}
            <ChevronDown size={12} className="ml-auto" />
          </summary>
          <div className="absolute left-0 top-10 z-30 w-64 space-y-3 rounded-md border border-zinc-700 bg-[light-dark(#f4f4f5,#171719)] p-3 shadow-xl">
            <label className="block space-y-1">
              <span>From</span>
              <Input
                aria-label="Audit from"
                type="datetime-local"
                className={compact}
                value={draft.from}
                onChange={(event) => set('from', event.target.value)}
              />
            </label>
            <label className="block space-y-1">
              <span>Until</span>
              <Input
                aria-label="Audit until"
                type="datetime-local"
                className={compact}
                value={draft.until}
                onChange={(event) => set('until', event.target.value)}
              />
            </label>
          </div>
        </details>
      )
    case 'action':
    case 'actor':
      return (
        <Input
          aria-label={`Filter ${id}`}
          className={compact}
          maxLength={128}
          placeholder={`All ${id === 'action' ? 'actions' : 'actors'}`}
          value={draft[id]}
          onChange={(event) => set(id, event.target.value)}
        />
      )
    case 'project':
      return (
        <Select
          aria-label="Filter project"
          className={compact}
          value={draft.project}
          onChange={(event) => set('project', event.target.value)}
        >
          <option value="">All projects</option>
          {projects.data?.items.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </Select>
      )
    case 'environment':
      return (
        <Select
          aria-label="Filter environment"
          className={compact}
          disabled={!draft.project}
          value={draft.environment}
          onChange={(event) => set('environment', event.target.value)}
        >
          <option value="">All environments</option>
          {environments.data?.environments.map((environment) => (
            <option key={environment.id} value={environment.id}>
              {environment.name}
            </option>
          ))}
        </Select>
      )
    case 'outcome':
      return (
        <Select
          aria-label="Filter outcome"
          className={compact}
          value={draft.outcome}
          onChange={(event) => set('outcome', event.target.value)}
        >
          <option value="">All outcomes</option>
          {['requested', 'succeeded', 'failed', 'committed', 'recorded'].map((outcome) => (
            <option key={outcome}>{outcome}</option>
          ))}
        </Select>
      )
    default:
      return null
  }
}
