import { Input } from '../../components/input'
import { Select } from '../../components/select'
import { Field } from '../../components/field'
import { Textarea } from '../../components/textarea'
import type { ServiceFormState } from './use-service-form'

function RecoveryFields({
  oci,
  allowReplacement,
}: Pick<ServiceFormState, 'oci'> & { allowReplacement: boolean }) {
  return (
    <div className="sm:col-span-2 rounded-md border border-zinc-800 p-4 space-y-4">
      <h3 className="text-sm">Recovery policy</h3>
      <p className="text-xs text-muted">
        Restart attempts are persisted on the worker.
        {allowReplacement &&
          ' Overlap-safe services with relocation enabled can also replace an exhausted instance on another worker.'}
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Restart attempts">
          <Input
            name="restart_attempts"
            type="number"
            defaultValue={oci?.recovery?.restartAttempts ?? 5}
            min={0}
            max={20}
            required
          />
        </Field>
        <Field label="Budget reset after (seconds)">
          <Input
            name="recovery_reset"
            type="number"
            defaultValue={oci?.recovery?.resetAfterSeconds ?? 600}
            min={30}
            max={86400}
            required
          />
        </Field>
        <Field label="Initial restart backoff (seconds)">
          <Input
            name="restart_backoff"
            type="number"
            defaultValue={oci?.recovery?.initialBackoffSeconds ?? 5}
            min={1}
            max={300}
            required
          />
        </Field>
        <Field label="Maximum restart backoff (seconds)">
          <Input
            name="restart_backoff_max"
            type="number"
            defaultValue={oci?.recovery?.maxBackoffSeconds ?? 60}
            min={1}
            max={3600}
            required
          />
        </Field>
        {allowReplacement && (
          <>
            <Field label="Replacement attempts">
              <Input
                name="replacement_attempts"
                type="number"
                defaultValue={oci?.recovery?.replacementAttempts ?? 3}
                min={0}
                max={10}
                required
              />
            </Field>
            <Field label="Replacement backoff (seconds)">
              <Input
                name="replacement_backoff"
                type="number"
                defaultValue={oci?.recovery?.replacementBackoffSeconds ?? 30}
                min={1}
                max={3600}
                required
              />
            </Field>
          </>
        )}
      </div>
    </div>
  )
}

function HttpProcessFields({ oci }: Pick<ServiceFormState, 'oci'>) {
  return (
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
      <div className="sm:col-span-2">
        <Field
          label="Liveness path (optional)"
          hint="Repeated failures restart the process. Readiness only removes traffic and never restarts it."
        >
          <Input
            name="liveness"
            defaultValue={oci?.liveness?.path ?? ''}
            placeholder="/health/live"
          />
        </Field>
      </div>
      <Field label="Liveness interval (seconds)">
        <Input
          name="liveness_interval"
          type="number"
          defaultValue={oci?.liveness?.intervalSeconds ?? 10}
          min={1}
          max={300}
          required
        />
      </Field>
      <Field label="Liveness failure threshold">
        <Input
          name="liveness_failures"
          type="number"
          defaultValue={oci?.liveness?.failureThreshold ?? 3}
          min={1}
          max={20}
          required
        />
      </Field>
      <RecoveryFields oci={oci} allowReplacement />
    </>
  )
}

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
        <>
          <p className="sm:col-span-2 text-sm text-muted">
            One running instance. Deployments stop the previous instance and wait for confirmed
            shutdown before starting its replacement. A running process is observed for 10 seconds;
            this does not verify application progress.
          </p>
          <RecoveryFields oci={oci} allowReplacement={false} />
        </>
      ) : (
        <HttpProcessFields oci={oci} />
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
