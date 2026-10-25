import { SelectedBuildDetails } from './selected-build-details'

import { Select } from '../../components/select'

import { sourceLabel } from '../../api'

import type { BuildPanelState } from './use-service-builds'

export function BuildHistory({
  history,
  selected,
  setSelectedId,
  cancel,
}: Pick<BuildPanelState, 'history' | 'selected' | 'setSelectedId' | 'cancel'>) {
  return (
    !!history.data?.length && (
      <>
        <label className="field [display:block] [min-width:0] [&_>_span]:[display:block] [&_>_span]:[color:light-dark(#27272a,_#c3c3ca)] [&_>_span]:[font-size:11px] [&_>_span]:[margin-bottom:8px] [&_>_label]:[display:block] [&_>_label]:[color:light-dark(#27272a,_#c3c3ca)] [&_>_label]:[font-size:11px] [&_>_label]:[margin-bottom:8px] [&_input]:[width:100%] [&_input]:[background:light-dark(#f4f4f5,_#171719)] [&_input]:[border:1px_solid_light-dark(#d4d4d8,_#38383c)] [&_input]:[border-radius:5px] [&_input]:[padding:12px_13px] [&_input]:[font-size:12px] [&_input]:[color:light-dark(#27272a,_#e7e7eb)] [&_input::placeholder]:[color:light-dark(#52525b,_#8d8d95)] [&_small]:[display:block] [&_small]:[font-size:10px] [&_small]:[line-height:1.7] [&_small]:[color:light-dark(#52525b,_#8d8d95)] [&_small]:[margin-top:7px]">
          <span>Build history (latest 50)</span>
          <Select
            className="build-select [width:100%] [background:light-dark(#f4f4f5,_#171719)] [border:1px_solid_light-dark(#d4d4d8,_#38383c)] [border-radius:5px] [padding:10px_12px] [font-size:12px] [color:light-dark(#27272a,_#e7e7eb)]"
            value={selected?.id}
            onChange={(event) => {
              setSelectedId(event.target.value)
              cancel.reset()
            }}
          >
            {history.data.map((build) => (
              <option key={build.id} value={build.id}>
                {new Date(build.createdAt).toLocaleString()} · {sourceLabel(build.spec.source)} ·{' '}
                {build.status}
              </option>
            ))}
          </Select>
        </label>
        {selected && <SelectedBuildDetails selected={selected} cancel={cancel} />}
      </>
    )
  )
}
