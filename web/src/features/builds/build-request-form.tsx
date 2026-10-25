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
        <label className="field [display:block] [min-width:0] [&_>_span]:[display:block] [&_>_span]:[color:light-dark(#27272a,_#c3c3ca)] [&_>_span]:[font-size:11px] [&_>_span]:[margin-bottom:8px] [&_>_label]:[display:block] [&_>_label]:[color:light-dark(#27272a,_#c3c3ca)] [&_>_label]:[font-size:11px] [&_>_label]:[margin-bottom:8px] [&_input]:[width:100%] [&_input]:[background:light-dark(#f4f4f5,_#171719)] [&_input]:[border:1px_solid_light-dark(#d4d4d8,_#38383c)] [&_input]:[border-radius:5px] [&_input]:[padding:12px_13px] [&_input]:[font-size:12px] [&_input]:[color:light-dark(#27272a,_#e7e7eb)] [&_input::placeholder]:[color:light-dark(#52525b,_#8d8d95)] [&_small]:[display:block] [&_small]:[font-size:10px] [&_small]:[line-height:1.7] [&_small]:[color:light-dark(#52525b,_#8d8d95)] [&_small]:[margin-top:7px]">
          <span>Build source type</span>
          <Select
            className="build-select [width:100%] [background:light-dark(#f4f4f5,_#171719)] [border:1px_solid_light-dark(#d4d4d8,_#38383c)] [border-radius:5px] [padding:10px_12px] [font-size:12px] [color:light-dark(#27272a,_#e7e7eb)]"
            value={sourceKind}
            onChange={(event) => setSourceKind(event.target.value as SourceKind)}
            disabled={create.isPending}
          >
            <option value="branch">Branch</option>
            <option value="tag">Tag</option>
            <option value="commit">Commit</option>
          </Select>
        </label>
        <label className="field [display:block] [min-width:0] [&_>_span]:[display:block] [&_>_span]:[color:light-dark(#27272a,_#c3c3ca)] [&_>_span]:[font-size:11px] [&_>_span]:[margin-bottom:8px] [&_>_label]:[display:block] [&_>_label]:[color:light-dark(#27272a,_#c3c3ca)] [&_>_label]:[font-size:11px] [&_>_label]:[margin-bottom:8px] [&_input]:[width:100%] [&_input]:[background:light-dark(#f4f4f5,_#171719)] [&_input]:[border:1px_solid_light-dark(#d4d4d8,_#38383c)] [&_input]:[border-radius:5px] [&_input]:[padding:12px_13px] [&_input]:[font-size:12px] [&_input]:[color:light-dark(#27272a,_#e7e7eb)] [&_input::placeholder]:[color:light-dark(#52525b,_#8d8d95)] [&_small]:[display:block] [&_small]:[font-size:10px] [&_small]:[line-height:1.7] [&_small]:[color:light-dark(#52525b,_#8d8d95)] [&_small]:[margin-top:7px]">
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
