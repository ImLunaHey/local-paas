import type { BuildPanelState } from './use-service-builds'

export function BuildWorkerStatus({ system }: Pick<BuildPanelState, 'system'>) {
  return (
    <span className="chip">
      {system.isError
        ? 'Builder status unavailable'
        : system.isPending
          ? 'Checking builder…'
          : system.data.workerOnline
            ? 'Build worker connected'
            : 'Waiting for builder'}
    </span>
  )
}
