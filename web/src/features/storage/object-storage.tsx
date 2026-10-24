import { BucketAttachmentDetails } from './bucket-attachment-details'
import { BucketAttachmentForm } from './bucket-attachment-form'

import { useBucketAttachment } from './use-bucket-attachment'

import type { Service } from '../../generated/model/service'

export function BucketPanel({ service }: { service: Service }) {
  const {
    managed,
    state,
    name,
    setName,
    bucket,
    setBucket,
    readOnly,
    setReadOnly,
    mutation,
    detach,
    own,
    current,
  } = useBucketAttachment({ service })
  return (
    <section className="panel space-y-5 p-6 mt-6">
      <div className="section-heading">
        <h2>{managed ? 'S3 buckets' : 'S3 storage attachment'}</h2>
        <span className="chip">RustFS · private</span>
      </div>
      <p className="text-xs text-muted">
        {managed
          ? 'Create private buckets after deploying this storage service. Attach them from an application’s Storage tab.'
          : 'Attach a bucket from this environment. The platform supplies scoped credentials through OpenBao; configure your S3 client for path-style requests.'}
      </p>
      {
        <BucketAttachmentDetails
          current={current}
          state={state}
          detach={detach}
          service={service}
        />
      }
      {managed && own.length > 0 && (
        <ul className="divide-y divide-zinc-800">
          {own.map((b) => (
            <li key={b.id} className="py-3 text-sm flex justify-between gap-4">
              <span>{b.name}</span>
              <span className="text-xs text-muted">{b.status}</span>
            </li>
          ))}
        </ul>
      )}
      {
        <BucketAttachmentForm
          current={current}
          managed={managed}
          name={name}
          setName={setName}
          bucket={bucket}
          setBucket={setBucket}
          readOnly={readOnly}
          setReadOnly={setReadOnly}
          mutation={mutation}
          state={state}
        />
      }
      {!managed && (
        <p className="text-xs text-muted">
          Adds S3_ENDPOINT, S3_BUCKET, AWS_REGION, AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY.
          Redeploy the application to use them. Administrator credentials are never supplied to
          apps.
        </p>
      )}
      {mutation.isSuccess && (
        <p role="status" className="text-xs text-emerald-300">
          {managed ? 'Bucket created.' : 'Bucket attached. Redeploy to use it.'}
        </p>
      )}
      {(state.error || mutation.error || detach.error) && (
        <p role="alert" className="error-notice">
          {(state.error || mutation.error)?.message}
        </p>
      )}
    </section>
  )
}
