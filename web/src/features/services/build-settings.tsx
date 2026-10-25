import { Input } from '../../components/input'
import { Select } from '../../components/select'
import { Field } from '../../components/field'
import { Textarea } from '../../components/textarea'

import type { ServiceFormState } from './use-service-form'

export function BuildSettings({
  oci,
  celld,
  buildMode,
  setBuildMode,
  kind,
}: Pick<ServiceFormState, 'oci' | 'celld' | 'buildMode' | 'setBuildMode' | 'kind'>) {
  return kind === 'oci-service' ? (
    <>
      <Field
        label="Build method"
        hint="Automatic uses your Dockerfile when present, otherwise detects a standalone Node, Bun, Python, Go, Rust, Ruby or PHP app with its committed lockfile. Most non-JavaScript apps require a Start command."
      >
        <Select
          name="buildMode"
          className="build-select [width:100%] [background:light-dark(#f4f4f5,_#171719)] [border:1px_solid_light-dark(#d4d4d8,_#38383c)] [border-radius:5px] [padding:10px_12px] [font-size:12px] [color:light-dark(#27272a,_#e7e7eb)]"
          value={buildMode}
          onChange={(event) => setBuildMode(event.target.value as typeof buildMode)}
        >
          <option value="auto">Automatic (Dockerfile or language detection)</option>
          <option value="dockerfile">Repository Dockerfile only</option>
          <option value="generated">Generate Dockerfile from app</option>
        </Select>
      </Field>
      {buildMode !== 'dockerfile' && (
        <>
          <Field
            label="Build command (optional)"
            hint="Blank uses the detected recipe default. A custom command selects a generated Dockerfile, even if the repository has one. Commands run inside the builder; use secret references for secrets."
          >
            <Input
              name="buildCommand"
              defaultValue={oci?.buildCommand ?? ''}
              placeholder="npm run build"
              maxLength={4096}
            />
          </Field>
          <Field
            label="Start command (optional)"
            hint="Blank uses scripts.start for JavaScript or the compiled app for Go. Python, Rust, Ruby and PHP require an explicit command."
          >
            <Input
              name="startCommand"
              defaultValue={oci?.startCommand ?? ''}
              placeholder="npm start"
              maxLength={4096}
            />
          </Field>
        </>
      )}
      <Field
        label="Dockerfile target (optional)"
        hint="Build a named stage, such as api or production. Requires a repository Dockerfile."
      >
        <Input
          name="buildTarget"
          defaultValue={oci?.buildTarget ?? ''}
          placeholder="production"
          maxLength={128}
        />
      </Field>
      <Field
        label="Build arguments (optional)"
        hint="One NAME=value per line. These are public build configuration and may appear in image metadata and build logs. Never enter secrets here."
      >
        <Textarea
          onChange={(e) => e.currentTarget.setCustomValidity('')}
          name="buildArgs"
          defaultValue={Object.entries(oci?.buildArgs ?? {})
            .map(([k, v]) => `${k}=${v}`)
            .join('\n')}
          placeholder="BINARY=api"
          rows={3}
          maxLength={20000}
        />
      </Field>
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Dockerfile path">
          <Input name="dockerfile" defaultValue={oci?.dockerfile ?? 'Dockerfile'} required />
        </Field>
        <Field label="Build context">
          <Input name="context" defaultValue={oci?.context ?? '.'} required />
        </Field>
      </div>
    </>
  ) : (
    <>
      <Field label="Wrangler configuration">
        <Input name="wrangler" defaultValue={celld?.wrangler ?? 'wrangler.jsonc'} required />
      </Field>
      <Field
        label="Bucket configuration reference"
        hint="A dedicated fleet's storage reference. Do not enter credentials."
      >
        <Input
          name="bucket"
          defaultValue={celld?.bucketRef}
          placeholder="my-durable-app-bucket"
          required
          pattern="[a-z0-9]+(-[a-z0-9]+)*"
        />
      </Field>
    </>
  )
}
