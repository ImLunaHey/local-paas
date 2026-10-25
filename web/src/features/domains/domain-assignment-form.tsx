import type { DomainObservation as Domain } from '../../generated/model/domainObservation'
import { Button } from '../../components/button'
import { Field } from '../../components/field'

import { Select } from '../../components/select'
import type { DomainAssignmentState } from './use-domain-assignment'

export function DomainAssignmentForm({
  domain,
  project,
  setProject,
  environment,
  setEnvironment,
  service,
  setService,
  projects,
  detail,
  services,
  save,
}: Pick<
  DomainAssignmentState,
  | 'project'
  | 'setProject'
  | 'environment'
  | 'setEnvironment'
  | 'service'
  | 'setService'
  | 'projects'
  | 'detail'
  | 'services'
  | 'save'
> & { domain: Domain }) {
  return (
    <form
      className="grid items-end gap-4 sm:grid-cols-2 xl:grid-cols-[1fr_1fr_1fr_auto]"
      onSubmit={(e) => {
        e.preventDefault()
        save.mutate()
      }}
    >
      <Field label="Project">
        <Select
          aria-label={'Project for ' + domain.hostname}
          value={project}
          onChange={(e) => {
            setProject(e.target.value)
            setEnvironment('')
            setService('')
          }}
        >
          <option value="">Unassigned</option>
          {projects.data?.items.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Environment">
        <Select
          aria-label={'Environment for ' + domain.hostname}
          disabled={!project || !detail.data}
          value={environment}
          onChange={(e) => {
            setEnvironment(e.target.value)
            setService('')
          }}
        >
          <option value="">Choose environment</option>
          {detail.data?.environments.map((e) => (
            <option key={e.id} value={e.name}>
              {e.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Service">
        <Select
          aria-label={'Service for ' + domain.hostname}
          disabled={!environment || !services.data}
          value={service}
          onChange={(e) => setService(e.target.value)}
        >
          <option value="">Choose service</option>
          {services.data?.items
            .filter(
              (s) =>
                (s.spec.workload.kind === 'oci-service' &&
                  s.spec.workload.execution !== 'worker') ||
                s.spec.workload.kind === 'celld-service',
            )
            .map((s) => (
              <option key={s.id} value={s.id}>
                {s.spec.name}
              </option>
            ))}
        </Select>
      </Field>
      <Button
        type="submit"
        disabled={save.isPending || (!!project && !service) || service === (domain.serviceId ?? '')}
      >
        Save assignment
      </Button>
    </form>
  )
}
