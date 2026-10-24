import { Button } from '../../components/button'
import { Input } from '../../components/input'
import { Select } from '../../components/select'
import type { FormEvent } from 'react'

import { Hammer, LoaderCircle } from 'lucide-react'

import type { SourceKind } from '../../api'
import type { BuildPanelState } from './use-service-builds'

export function BuildRequestForm({
  database,
  uploaded,
  sourceKind,
  setSourceKind,
  commit,
  setCommit,
  noCache,
  setNoCache,
  create,
  busy,
  history,
}: Pick<
  BuildPanelState,
  | 'database'
  | 'uploaded'
  | 'sourceKind'
  | 'setSourceKind'
  | 'commit'
  | 'setCommit'
  | 'noCache'
  | 'setNoCache'
  | 'create'
  | 'busy'
  | 'history'
>) {
  function submit(event: FormEvent) {
    event.preventDefault()
    if (!busy && !create.isPending) create.mutate()
  }
  return (
    <form onSubmit={submit} className="space-y-3">
      <fieldset disabled={database || uploaded} hidden={database || uploaded} className="space-y-3">
        <label className="field">
          <span>Build source type</span>
          <Select
            className="build-select"
            value={sourceKind}
            onChange={(event) => setSourceKind(event.target.value as SourceKind)}
            disabled={create.isPending}
          >
            <option value="branch">Branch</option>
            <option value="tag">Tag</option>
            <option value="commit">Commit</option>
          </Select>
        </label>
        <label className="field">
          <span>
            {sourceKind === 'commit'
              ? 'Build commit SHA'
              : sourceKind === 'branch'
                ? 'Build branch'
                : 'Build tag'}
          </span>
          <Input
            className="font-mono"
            value={commit}
            onChange={(event) => setCommit(event.target.value)}
            pattern={sourceKind === 'commit' ? '([a-f0-9]{40}|[a-f0-9]{64})' : undefined}
            required
            disabled={create.isPending}
          />
        </label>
      </fieldset>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <label className="flex items-center gap-2 text-xs text-muted">
          <Input
            type="checkbox"
            checked={noCache}
            onChange={(event) => setNoCache(event.target.checked)}
            disabled={create.isPending}
          />
          Bypass build cache
        </label>
        <Button
          variant="primary"
          type="submit"
          disabled={busy || create.isPending || history.isPending || history.isError}
        >
          {create.isPending ? (
            <LoaderCircle size={15} className="animate-spin" />
          ) : (
            <Hammer size={15} />
          )}
          Queue build
        </Button>
      </div>
    </form>
  )
}
