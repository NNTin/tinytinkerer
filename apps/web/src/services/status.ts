import type { SystemStatus } from '@tinytinkerer/types'
import { z } from 'zod'
import { edgeUrl } from './config'

const serviceStatusSchema = z.object({
  state: z.enum(['ready', 'degraded', 'offline']),
  detail: z.string(),
  error: z.string().optional()
})

const systemStatusSchema = z.object({
  auth: serviceStatusSchema,
  models: serviceStatusSchema,
  search: serviceStatusSchema
})

export const fetchStatus = async (): Promise<SystemStatus> => {
  const response = await fetch(`${edgeUrl}/health`)
  if (!response.ok) {
    throw new Error('Unable to reach edge status endpoint')
  }

  // Runtime-validate the external response before returning as SystemStatus.
  // The schema matches SystemStatus exactly; the cast is safe after parse succeeds.
  return systemStatusSchema.parse(await response.json()) as SystemStatus
}
