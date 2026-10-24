import { RuntimeProcessFields } from './runtime-process-fields'
import { Input } from '../../components/input'

import { Field } from '../../components/field'

import type { ServiceFormState } from './use-service-form'
export function RuntimeStep({
  baseline,
  spec,
  oci,
  celld,
  execution,
  setExecution,
  setDirty,
  kind,
  worker,
}: Pick<
  ServiceFormState,
  | 'baseline'
  | 'spec'
  | 'oci'
  | 'celld'
  | 'execution'
  | 'setExecution'
  | 'setDirty'
  | 'kind'
  | 'worker'
>) {
  return (
    <section className="panel form-section">
      <h2>
        <span className="step">03</span> Runtime requirements
      </h2>
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="CPU per instance (millicores)">
          <Input
            name="cpu"
            type="number"
            defaultValue={spec?.resources.cpuMillis ?? 500}
            min={1}
            max={64000}
            required
          />
        </Field>
        <Field label="Memory per instance (MiB)">
          <Input
            name="memory"
            type="number"
            defaultValue={spec?.resources.memoryMib ?? 512}
            min={16}
            max={65536}
            required
          />
        </Field>
        {
          <RuntimeProcessFields
            baseline={baseline}
            oci={oci}
            celld={celld}
            execution={execution}
            setExecution={setExecution}
            setDirty={setDirty}
            kind={kind}
            worker={worker}
          />
        }
      </div>
      {!worker && (
        <label className="checkbox-field">
          <Input type="checkbox" name="distinct" defaultChecked={spec?.distinctNodes ?? true} />
          <span>
            Spread across distinct nodes
            <small>VMs on the same host share one physical failure domain.</small>
          </span>
        </label>
      )}
    </section>
  )
}
