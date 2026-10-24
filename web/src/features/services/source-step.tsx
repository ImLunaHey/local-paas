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
    <section className="panel form-section">
      <h2>
        <span className="step">02</span> Source
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
                className="build-select"
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
