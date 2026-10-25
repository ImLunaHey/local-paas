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
    <section className="panel form-section [background:light-dark(#f4f4f5,_#131315)] [border:1px_solid_light-dark(#e4e4e7,_#28282c)] [border-radius:8px] [box-shadow:0_1px_0_#ffffff04_inset,_0_8px_24px_#0000000d] [padding:25px] [&_h2]:[display:flex] [&_h2]:[align-items:center] [&_h2]:[gap:10px] [&_h2]:[margin-bottom:23px] max-[720px]:[padding:20px]">
      <h2>
        <span className="step [font-family:var(--font-mono)] [font-size:10px] [color:light-dark(#52525b,_#8d8d95)] [border:1px_solid_light-dark(#d4d4d8,_#38383c)] [border-radius:5px] [padding:4px_6px]">
          03
        </span>{' '}
        Runtime requirements
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
        <label className="checkbox-field [display:flex] [gap:10px] [font-size:11px] [color:light-dark(#27272a,_#c3c3ca)] [margin-top:24px] [align-items:start] [&_input]:[accent-color:#ff8a4c] [&_input]:[margin-top:1px] [&_small]:[display:block] [&_small]:[font-size:10px] [&_small]:[color:light-dark(#52525b,_#8d8d95)] [&_small]:[margin-top:7px] [&_small]:[line-height:1.6]">
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
