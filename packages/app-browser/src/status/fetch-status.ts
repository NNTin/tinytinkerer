import type { SystemStatus } from '@tinytinkerer/contracts'
import { systemStatusSchema } from '@tinytinkerer/contracts'

export const fetchStatus = async (edgeBaseUrl: string): Promise<SystemStatus> => {
  const response = await fetch(`${edgeBaseUrl}/health`)
  if (!response.ok) {
    throw new Error('Unable to reach edge status endpoint')
  }
  return systemStatusSchema.parse(await response.json())
}
