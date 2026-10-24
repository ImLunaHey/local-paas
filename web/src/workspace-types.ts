export interface Project {
  id: string
  name: string
  environments: { id: string; name: string }[]
}
