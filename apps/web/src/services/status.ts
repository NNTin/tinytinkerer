import { fetchStatus as _fetchStatus } from '@tinytinkerer/app-browser'
import { edgeUrl } from './config'

export const fetchStatus = (): Promise<import('@tinytinkerer/app-browser').SystemStatus> =>
  _fetchStatus(edgeUrl)
