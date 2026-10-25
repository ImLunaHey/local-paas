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
    <section className="panel space-y-5 p-6 mt-6 [background:light-dark(#f4f4f5,_#131315)] [border:1px_solid_light-dark(#e4e4e7,_#28282c)] [border-radius:8px] [box-shadow:0_1px_0_#ffffff04_inset,_0_8px_24px_#0000000d]">
      <div className="section-heading [display:flex] [justify-content:space-between] [align-items:center] [margin-bottom:15px] [gap:12px] max-[720px]:[&_.tiny-label]:[font-size:8px] max-[720px]:[&_.tiny-label]:[letter-spacing:0.6px]">
        <h2>{managed ? 'S3 buckets' : 'S3 storage attachment'}</h2>
        <span className="chip [&[data-state=succeeded]]:[color:#9bd2a8] [&[data-state=succeeded]]:[background:light-dark(#e4e4e7,_#18271d)] [&[data-state=succeeded]]:[border-color:#2d4a35] [&[data-state=failed]]:[color:#ffaaa1] [&[data-state=failed]]:[background:light-dark(#e4e4e7,_#2a1919)] [&[data-state=failed]]:[border-color:#4b2a2a] [&[data-state=interrupted]]:[color:#ffaaa1] [&[data-state=interrupted]]:[background:light-dark(#e4e4e7,_#2a1919)] [&[data-state=interrupted]]:[border-color:#4b2a2a] [&[data-state=running]]:[color:#ffb282] [&[data-state=running]]:[background:#2c1c12] [&[data-state=running]]:[border-color:#4e3120] [&[data-state=queued]]:[color:#ffb282] [&[data-state=queued]]:[background:#2c1c12] [&[data-state=queued]]:[border-color:#4e3120] [display:inline-flex] [align-items:center] [gap:6px] [border:1px_solid_light-dark(#d4d4d8,_#38383c)] [background:light-dark(#e4e4e7,_#1b1b1e)] [color:light-dark(#27272a,_#c3c3ca)] [font-size:10px] [padding:5px_8px] [border-radius:5px] [white-space:nowrap]">
          RustFS · private
        </span>
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
        <p
          role="alert"
          className="error-notice [border:1px_solid_#4d2b2d] [background:light-dark(#f4f4f5,_#231719)] [border-radius:7px] [padding:18px] [font-size:12px] [color:#ffb4ae] [line-height:1.8] [overflow-wrap:anywhere] [&_p]:[margin-top:5px]"
        >
          {(state.error || mutation.error)?.message}
        </p>
      )}
    </section>
  )
}
