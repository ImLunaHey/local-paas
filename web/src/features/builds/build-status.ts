import type { Build } from '../../api'
export const active = (build?: Build) => build?.status === 'queued' || build?.status === 'running'
