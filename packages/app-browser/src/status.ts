import type { SystemStatus } from '@tinytinkerer/contracts'
import { getBrowserShell } from './shell'

export const fetchStatus = async (): Promise<SystemStatus> =>
  getBrowserShell().statusGateway.fetchStatus()
