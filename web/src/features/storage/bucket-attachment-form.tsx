import { Button } from '../../components/button'
import { Field } from '../../components/field'
import { Input } from '../../components/input'
import { Select } from '../../components/select'
import type { BucketPanelState } from './use-bucket-attachment'

export function BucketAttachmentForm({
  current,
  managed,
  name,
  setName,
  bucket,
  setBucket,
  readOnly,
  setReadOnly,
  mutation,
  state,
}: Pick<
  BucketPanelState,
  | 'current'
  | 'managed'
  | 'name'
  | 'setName'
  | 'bucket'
  | 'setBucket'
  | 'readOnly'
  | 'setReadOnly'
  | 'mutation'
  | 'state'
>) {
  return (
    !current && (
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          mutation.mutate()
        }}
      >
        {managed ? (
          <Field label="Bucket name">
            <Input
              required
              minLength={3}
              maxLength={63}
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
              placeholder="uploads"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
        ) : (
          <>
            <Field label="Bucket">
              <Select required value={bucket} onChange={(e) => setBucket(e.target.value)}>
                <option value="">Choose a bucket</option>
                {state.data?.buckets
                  .filter((b) => b.status === 'ready')
                  .map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.storage} / {b.name}
                    </option>
                  ))}
              </Select>
            </Field>
            <Field label="Bucket access">
              <Select
                value={readOnly ? 'ro' : 'rw'}
                onChange={(e) => setReadOnly(e.target.value === 'ro')}
              >
                <option value="rw">Read and write</option>
                <option value="ro">Read only</option>
              </Select>
            </Field>
          </>
        )}
        <Button variant="primary" type="submit" disabled={mutation.isPending}>
          {managed ? 'Create bucket' : 'Attach bucket'}
        </Button>
      </form>
    )
  )
}
