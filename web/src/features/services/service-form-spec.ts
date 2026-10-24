import type { ServiceSpec } from '../../generated/model/serviceSpec'
import type { Workload } from '../../generated/model/workload'
import type { SourceKind } from '../../api'

export interface ServiceFormInput {
  kind: 'oci-service' | 'celld-service'
  buildMode: 'auto' | 'dockerfile' | 'generated'
  worker: boolean
  sourceMode: 'git' | 'upload'
  uploadDigest?: string | null
  sourceKind: SourceKind
  sourceValue: string
  spec?: ServiceSpec
}

export function readServiceForm(
  form: HTMLFormElement,
  input: ServiceFormInput,
): ServiceSpec | undefined {
  const { kind, buildMode, worker, sourceMode, uploadDigest, sourceKind, sourceValue, spec } = input
  const oci = spec?.workload.kind === 'oci-service' ? spec.workload : undefined
  const data = new FormData(form)
  const text = (key: string) => String(data.get(key) ?? '').trim()
  const number = (key: string) => Number(text(key))
  const buildArgsInput = form.elements.namedItem('buildArgs') as HTMLTextAreaElement | null
  const lines = text('buildArgs').split('\n').filter(Boolean)
  const keys = lines.map((line) => line.slice(0, line.indexOf('=')))
  if (buildArgsInput) {
    buildArgsInput.setCustomValidity(
      lines.some((line) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(line)) ||
        new Set(keys).size !== keys.length
        ? 'Use unique NAME=value entries, one per line.'
        : '',
    )
    if (!buildArgsInput.reportValidity()) return
  }
  const workload: Workload =
    kind === 'oci-service'
      ? {
          kind,
          buildMode: buildMode,
          privateConnections: oci?.privateConnections,
          buildCommand: buildMode === 'dockerfile' ? undefined : text('buildCommand') || undefined,
          startCommand: buildMode === 'dockerfile' ? undefined : text('startCommand') || undefined,
          buildArgs: Object.fromEntries(
            lines.map((line) => {
              const split = line.indexOf('=')
              return [line.slice(0, split), line.slice(split + 1)]
            }),
          ),
          buildTarget: text('buildTarget') || undefined,
          preDeploy: text('pre_deploy_executable')
            ? {
                command: [
                  text('pre_deploy_executable'),
                  ...text('pre_deploy_arguments').split('\n').filter(Boolean),
                ],
                timeoutSeconds: number('pre_deploy_timeout'),
              }
            : undefined,
          dockerfile: text('dockerfile'),
          context: text('context'),
          execution: worker ? 'worker' : undefined,
          replicas: worker ? 1 : number('replicas'),
          port: worker ? undefined : number('port'),
          readiness: worker
            ? undefined
            : {
                path: text('readiness'),
                intervalSeconds: number('interval'),
                stabilizationSeconds: number('stabilization'),
              },
        }
      : {
          kind,
          wrangler: text('wrangler'),
          members: number('members'),
          bucketRef: text('bucket'),
        }
  return {
    schemaVersion: 1,
    project: text('project'),
    environment: text('environment'),
    name: text('name'),
    source:
      kind === 'oci-service' && sourceMode === 'upload'
        ? { repository: '', upload: uploadDigest }
        : { repository: text('repository'), [sourceKind]: sourceValue.trim() },
    resources: { cpuMillis: number('cpu'), memoryMib: number('memory') },
    distinctNodes: worker ? false : data.has('distinct'),
    domains: worker ? [] : data.getAll('domains').map(String),
    secrets: spec?.secrets ?? [],
    workload,
    volume: spec?.volume,
  }
}
