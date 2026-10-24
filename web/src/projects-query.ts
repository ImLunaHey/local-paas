import type { ProjectList } from './generated/model/projectList'
import { getListProjectsQueryOptions } from './generated/management'
export const projectsQuery = getListProjectsQueryOptions<ProjectList, Error>({
  query: { queryKey: ['projects'] },
})
