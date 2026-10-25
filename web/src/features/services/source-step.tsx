import { BuildSettings } from './build-settings'
import { SourceUpload } from '../../source-upload'

import { Input } from '../../components/input'
import { Select } from '../../components/select'
import { Field } from '../../components/field'

import type { SourceKind } from '../../api'

import type { ServiceFormState } from './use-service-form'
export function SourceStep({
  scope,
  spec,
  oci,
  celld,
  sourceMode,
  setSourceMode,
  uploadDigest,
  setUploadDigest,
  sourceKind,
  setSourceKind,
  sourceValue,
  setSourceValue,
  buildMode,
  setBuildMode,
  setDirty,
  kind,
}: Pick<
  ServiceFormState,
  | 'scope'
  | 'spec'
  | 'oci'
  | 'celld'
  | 'sourceMode'
  | 'setSourceMode'
  | 'uploadDigest'
  | 'setUploadDigest'
  | 'sourceKind'
  | 'setSourceKind'
  | 'sourceValue'
  | 'setSourceValue'
  | 'buildMode'
  | 'setBuildMode'
  | 'setDirty'
  | 'kind'
>) {
  return (
    <section className="panel form-section [background:light-dark(#f4f4f5,_#131315)] [border:1px_solid_light-dark(#e4e4e7,_#28282c)] [border-radius:8px] [box-shadow:0_1px_0_#ffffff04_inset,_0_8px_24px_#0000000d] [padding:25px] [&_h2]:[display:flex] [&_h2]:[align-items:center] [&_h2]:[gap:10px] [&_h2]:[margin-bottom:23px] max-[720px]:[padding:20px]">
      <h2>
        <span className="step [font-family:var(--font-mono)] [font-size:10px] [color:light-dark(#52525b,_#8d8d95)] [border:1px_solid_light-dark(#d4d4d8,_#38383c)] [border-radius:5px] [padding:4px_6px]">
          02
        </span>{' '}
        Source
      </h2>
      <div className="space-y-4">
        {kind === 'oci-service' && (
          <Field label="Deployment source">
            <Select
              value={sourceMode}
              onChange={(e) => {
                setSourceMode(e.target.value as 'git' | 'upload')
                setDirty(true)
              }}
            >
              <option value="git">Git repository</option>
              <option value="upload">ZIP or local files</option>
            </Select>
          </Field>
        )}
        {kind === 'oci-service' && sourceMode === 'upload' ? (
          <SourceUpload
            project={spec?.project ?? scope.project ?? ''}
            digest={uploadDigest ?? undefined}
            onChange={(digest) => {
              setUploadDigest(digest)
              setDirty(true)
            }}
          />
        ) : (
          <>
            <Field
              label="Git repository"
              hint="An HTTPS URL without a token or embedded credentials."
            >
              <Input
                name="repository"
                defaultValue={spec?.source?.repository}
                type="url"
                placeholder="https://github.com/you/your-app.git"
                required
                maxLength={2048}
              />
            </Field>
            <Field label="Source type">
              <Select
                className="build-select [width:100%] [background:light-dark(#f4f4f5,_#171719)] [border:1px_solid_light-dark(#d4d4d8,_#38383c)] [border-radius:5px] [padding:10px_12px] [font-size:12px] [color:light-dark(#27272a,_#e7e7eb)]"
                value={sourceKind}
                onChange={(event) => setSourceKind(event.target.value as SourceKind)}
              >
                <option value="branch">Branch</option>
                <option value="tag">Tag</option>
                <option value="commit">Commit</option>
              </Select>
            </Field>
            <Field
              label={
                sourceKind === 'commit' ? 'Commit SHA' : sourceKind === 'branch' ? 'Branch' : 'Tag'
              }
              hint="Branches and tags are resolved to an exact commit for each build."
            >
              <Input
                name="source_ref"
                className="font-mono"
                value={sourceValue}
                onChange={(event) => setSourceValue(event.target.value)}
                required
                pattern={sourceKind === 'commit' ? '([a-f0-9]{40}|[a-f0-9]{64})' : undefined}
              />
            </Field>
          </>
        )}
        {
          <BuildSettings
            oci={oci}
            celld={celld}
            buildMode={buildMode}
            setBuildMode={setBuildMode}
            kind={kind}
          />
        }
      </div>
    </section>
  )
}
