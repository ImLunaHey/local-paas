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
        <label className="field">
          <span>Build history (latest 50)</span>
          <Select
            className="build-select"
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
