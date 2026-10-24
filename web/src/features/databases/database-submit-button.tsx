import type { Service } from '../../generated/model/service'
import { Button } from '../../components/button'

import type { DatabaseFormState } from './use-database-form'

export function DatabaseSubmitButton({
  service,
  mutation,
  capabilities,
  engine,
}: Pick<DatabaseFormState, 'mutation' | 'capabilities' | 'engine'> & { service?: Service }) {
  return (
    <Button
      variant="primary"
      type="submit"
      disabled={mutation.isPending || (!service && !capabilities.data?.databaseRuntimeReady)}
    >
      {service
        ? 'Save changes'
        : capabilities.data?.databaseRuntimeReady
          ? engine === 'rustfs-service'
            ? 'Create S3 storage'
            : 'Create database'
          : 'Waiting for database workers'}
    </Button>
  )
}
