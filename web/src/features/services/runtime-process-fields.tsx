import { Input } from '../../components/input'
import { Select } from '../../components/select'
import { Field } from '../../components/field'
import { Textarea } from '../../components/textarea'
import type { ServiceFormState } from './use-service-form'

export function RuntimeProcessFields({
  baseline,
  oci,
  celld,
  execution,
  setExecution,
  setDirty,
  kind,
  worker,
}: Pick<
  ServiceFormState,
  'baseline' | 'oci' | 'celld' | 'execution' | 'setExecution' | 'setDirty' | 'kind' | 'worker'
>) {
  return kind === 'oci-service' ? (
    <>
      <div className="sm:col-span-2 rounded-md border border-zinc-800 p-4 space-y-4">
        <h3 className="text-sm">Pre-deploy command</h3>
        <p className="text-xs text-muted">
          Run a migration or release task from the candidate image before starting new instances. A
          failed task leaves the current app running. Database changes must remain compatible with
          the old app; they are not automatically rolled back.
        </p>
        <Field
          label="Pre-deploy executable (optional)"
          hint="An executable inside your image. Leave blank to disable. Arguments are passed literally, without shell parsing."
        >
          <Input
            name="pre_deploy_executable"
            defaultValue={oci?.preDeploy?.command[0]}
            placeholder="bun"
            maxLength={4096}
          />
        </Field>
        <Field
          label="Pre-deploy arguments"
          hint="One argument per line. For bun run db:migrate, enter run and db:migrate on separate lines. Use OpenBao for secrets."
        >
          <Textarea
            name="pre_deploy_arguments"
            defaultValue={oci?.preDeploy?.command.slice(1).join('\n')}
            placeholder={'run\ndb:migrate'}
            maxLength={16384}
            rows={3}
          />
        </Field>
        <Field label="Pre-deploy time limit (seconds)">
          <Input
            name="pre_deploy_timeout"
            type="number"
            min={10}
            max={86400}
            defaultValue={oci?.preDeploy?.timeoutSeconds ?? 300}
            required
          />
        </Field>
      </div>
      <Field
        label="Process type"
        hint={
          baseline
            ? 'Process type is fixed when the service is created.'
            : 'Workers run continuously without receiving HTTP requests.'
        }
        className="sm:col-span-2"
      >
        <Select
          name="execution"
          value={execution}
          disabled={!!baseline}
          onChange={(e) => {
            setExecution(e.target.value as 'http' | 'worker')
            setDirty(true)
          }}
        >
          <option value="http">Web application / API</option>
          <option value="worker">Background worker · singleton</option>
        </Select>
      </Field>
      {worker ? (
        <p className="sm:col-span-2 text-sm text-muted">
          One running instance. Deployments stop the previous instance and wait for confirmed
          shutdown before starting its replacement. A running process is observed for 10 seconds;
          this does not verify application progress.
        </p>
      ) : (
        <>
          <Field label="Replicas">
            <Input
              name="replicas"
              type="number"
              defaultValue={oci?.replicas ?? 2}
              min={1}
              max={32}
              required
            />
          </Field>
          <Field label="HTTP port">
            <Input
              name="port"
              type="number"
              defaultValue={oci?.port ?? 3000}
              min={1}
              max={65535}
              required
            />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Readiness path">
              <Input name="readiness" defaultValue={oci?.readiness?.path ?? '/health'} required />
            </Field>
          </div>
          <Field label="Check interval (seconds)">
            <Input
              name="interval"
              type="number"
              defaultValue={oci?.readiness?.intervalSeconds ?? 10}
              min={1}
              max={300}
              required
            />
          </Field>
          <Field label="Stabilization period (seconds)">
            <Input
              name="stabilization"
              type="number"
              defaultValue={oci?.readiness?.stabilizationSeconds ?? 30}
              min={1}
              max={3600}
              required
            />
          </Field>
        </>
      )}
    </>
  ) : (
    <Field label="Fleet members">
      <Input
        name="members"
        type="number"
        defaultValue={celld?.members ?? 3}
        min={2}
        max={32}
        required
      />
    </Field>
  )
}
