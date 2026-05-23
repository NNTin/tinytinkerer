import type { SystemStatus } from '@tinytinkerer/contracts'
import { getBrowserShell } from './shell'

export const fetchStatus = async (): Promise<SystemStatus> =>
  getBrowserShell().statusGateway.fetchStatus()

export const startStatusPolling = (
  refresh: () => Promise<void>,
  intervalMs = 15_000
): (() => void) => {
  void refresh()
  const intervalId = window.setInterval(() => {
    void refresh()
  }, intervalMs)

  return () => window.clearInterval(intervalId)
}
