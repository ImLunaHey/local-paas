import type { Draft } from './job-types'

import { type Revision } from '../../api'

import { Field } from '../../components/field'
import { Input } from '../../components/input'
import { Select } from '../../components/select'
import { Textarea } from '../../components/textarea'

export function JobFields({
  draft,
  setDraft,
  revisions,
}: {
  draft: Draft
  setDraft: (draft: Draft) => void
  revisions: Revision[]
}) {
  return (
    <div className="grid min-w-0 gap-5 sm:grid-cols-2">
      <Field
        label="Image revision"
        hint="Pinned to this immutable image, even after another build."
      >
        <Select
          required
          value={draft.revision}
          onChange={(e) => setDraft({ ...draft, revision: e.target.value })}
        >
          {!draft.revision && <option value="">Build an image first</option>}
          {draft.revision && !revisions.some((r) => r.id === draft.revision) && (
            <option value={draft.revision}>{draft.revision.slice(0, 8)} · retained revision</option>
          )}
          {revisions.map((r) => (
            <option key={r.id} value={r.id}>
              {r.id.slice(0, 8)} · {new Date(r.createdAt).toLocaleString()}
            </option>
          ))}
        </Select>
      </Field>
      <Field
        label="Time limit (seconds)"
        hint="10 seconds to 24 hours, including image preparation after assignment."
      >
        <Input
          required
          type="number"
          min={10}
          max={86400}
          value={draft.timeout}
          onChange={(e) => setDraft({ ...draft, timeout: Number(e.target.value) })}
        />
      </Field>
      <Field
        label="Executable"
        hint="Leave empty to use the image’s default command. Overrides its entrypoint and command."
        className="sm:col-span-2"
      >
        <Input
          maxLength={4096}
          placeholder="e.g. /app/import_wikidata"
          value={draft.executable}
          onChange={(e) => setDraft({ ...draft, executable: e.target.value })}
        />
      </Field>
      {draft.executable && (
        <Field
          label="Arguments"
          hint="One argument per line, without shell quoting. Use the Secrets tab for credentials; command text is saved in run history."
          className="sm:col-span-2"
        >
          <Textarea
            maxLength={16384}
            placeholder={'--limit\n100'}
            value={draft.arguments}
            onChange={(e) => setDraft({ ...draft, arguments: e.target.value })}
          />
        </Field>
      )}
    </div>
  )
}
