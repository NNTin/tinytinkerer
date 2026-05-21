import type { SystemStatus } from '@tinytinkerer/types'

const edgeUrl = import.meta.env.VITE_EDGE_URL ?? 'http://127.0.0.1:8787'

export const fetchStatus = async (): Promise<SystemStatus> => {
  const response = await fetch(`${edgeUrl}/health`)
  if (!response.ok) {
    throw new Error('Unable to reach edge status endpoint')
  }

  return (await response.json()) as SystemStatus
}
