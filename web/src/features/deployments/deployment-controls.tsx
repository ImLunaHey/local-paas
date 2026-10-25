import { Button } from '../../components/button'
import { Select } from '../../components/select'
import { Field } from '../../components/field'

import { LoaderCircle, Play } from 'lucide-react'

import type { DeploymentPanelState } from './use-deployment-panel'

export function DeploymentControls({
  revisions,
  revision,
  setChosen,
  deploy,
  runtime,
  preparing,
}: Pick<DeploymentPanelState, 'revisions' | 'revision' | 'setChosen' | 'deploy' | 'runtime'> & {
  preparing: boolean | undefined
}) {
  return (
    <div className="flex flex-wrap gap-3 items-end">
      <Field label="Image revision" className="flex-1 min-w-0">
        <Select
          aria-label="Deployment revision"
          className="build-select mt-2 [width:100%] [background:light-dark(#f4f4f5,_#171719)] [border:1px_solid_light-dark(#d4d4d8,_#38383c)] [border-radius:5px] [padding:10px_12px] [font-size:12px] [color:light-dark(#27272a,_#e7e7eb)]"
          value={revision}
          onChange={(e) => setChosen(e.target.value)}
        >
          {!revisions.data?.length && <option value="">No built revisions</option>}
          {revisions.data?.map((r) => (
            <option key={r.id} value={r.id}>
              {new Date(r.createdAt).toLocaleString()} · {r.imageDigest.slice(0, 19)}
            </option>
          ))}
        </Select>
      </Field>
      <Button
        variant="primary"
        onClick={() => deploy.mutate()}
        disabled={
          !revision ||
          !runtime.data?.healthyNodes ||
          preparing ||
          deploy.isPending ||
          runtime.isError
        }
      >
        {deploy.isPending ? (
          <LoaderCircle size={14} className="animate-spin" />
        ) : (
          <Play size={14} />
        )}{' '}
        Deploy revision
      </Button>
    </div>
  )
}
