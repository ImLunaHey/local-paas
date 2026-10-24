import type { ServiceFormState } from './use-service-form'
import { ErrorNotice } from '../../components/error-notice'
export function ServiceFormFeedback({
  baseline,
  mutation,
  dirty,
  creationLocked,
  reloadError,
}: Pick<ServiceFormState, 'baseline' | 'mutation' | 'dirty' | 'creationLocked' | 'reloadError'>) {
  return (
    <>
      {baseline && mutation.isSuccess && !dirty && (
        <p role="status" className="text-sm text-accent">
          Configuration saved.
        </p>
      )}
      {creationLocked && mutation.isError && (
        <p role="status" className="text-sm text-muted">
          Your service is saved. Retry to finish saving secrets and start its build.
        </p>
      )}
      {reloadError && <ErrorNotice error={reloadError} />}
      {mutation.isError && <ErrorNotice error={mutation.error} />}
    </>
  )
}
