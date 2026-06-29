import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import {
  createBridgeServer,
  defineBridgeVerb,
  parentServerTransport
} from '@tinytinkerer/app-bridge'
import type { BridgeServer, CreateBridgeServerOptions } from '@tinytinkerer/app-bridge'
import {
  EXCALIDRAW_APP_ID,
  EXCALIDRAW_PROTOCOL_VERSION,
  excalidrawVerbContracts
} from '@tinytinkerer/excalidraw-protocol'
import { executeClear, executeDraw } from './create'
import { executeEdit } from './edit'
import { executeInspect, executeRead, executeSearch } from './query'

// This file is deliberately only the wire binding surface. Excalidraw owns the
// behavior in the adjacent create/query/normalization/edit modules.
export const createExcalidrawHandlers = (
  api: ExcalidrawImperativeAPI
): CreateBridgeServerOptions['handlers'] => ({
  draw: defineBridgeVerb(excalidrawVerbContracts.draw, (input) => executeDraw(api, input)),
  search: defineBridgeVerb(excalidrawVerbContracts.search, (input) => executeSearch(api, input)),
  inspect: defineBridgeVerb(excalidrawVerbContracts.inspect, (input) => executeInspect(api, input)),
  read: defineBridgeVerb(excalidrawVerbContracts.read, (input) => executeRead(api, input)),
  edit: defineBridgeVerb(excalidrawVerbContracts.edit, (input) => executeEdit(api, input)),
  clear: defineBridgeVerb(excalidrawVerbContracts.clear, (input) => executeClear(api, input))
})

export const createExcalidrawBridge = (
  api: ExcalidrawImperativeAPI,
  sessionNonce: string
): BridgeServer =>
  createBridgeServer(parentServerTransport(), {
    appId: EXCALIDRAW_APP_ID,
    appProtocolVersion: EXCALIDRAW_PROTOCOL_VERSION,
    sessionNonce,
    handlers: createExcalidrawHandlers(api)
  })
