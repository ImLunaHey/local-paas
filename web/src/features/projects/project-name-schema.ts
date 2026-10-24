import { z } from 'zod'

export const projectNameSchema = z.object({
  name: z
    .string()
    .min(1, 'Enter a project name.')
    .max(63)
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and single hyphens.'),
})
