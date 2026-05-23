import type { SystemStatus } from '@tinytinkerer/contracts'
import { systemStatusSchema } from '@tinytinkerer/contracts'
import { edgeUrl } from './config'

export const fetchStatus = async (): Promise<SystemStatus> => {
  const response = await fetch(`${edgeUrl}/health`)
  if (!response.ok) {
    throw new Error('Unable to reach edge status endpoint')
  }
  return systemStatusSchema.parse(await response.json())
}
