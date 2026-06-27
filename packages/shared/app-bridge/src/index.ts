// @tinytinkerer/app-bridge — the product-agnostic wire contract between the chat
// harness and an embedded iframe app. Knows nothing about any specific app
// (Excalidraw or otherwise); per-app verb payload schemas compose on top of this.
export {
  APP_BRIDGE_PROTOCOL_VERSION,
  bridgeMessageSchema,
  requestMessageSchema,
  responseMessageSchema,
  eventMessageSchema,
  readyMessageSchema,
  helloMessageSchema
} from './protocol'
export type {
  BridgeMessage,
  RequestMessage,
  ResponseMessage,
  EventMessage,
  ReadyMessage,
  HelloMessage
} from './protocol'

export type { BridgeTransport } from './transport'

export {
  createBridgeClient,
  BridgeCapabilityMismatchError,
  BridgeVersionMismatchError
} from './client'
export type { BridgeClient, BridgeHandshake, CreateBridgeClientOptions } from './client'

export { createBridgeServer, defineBridgeVerb } from './server'
export type {
  BridgeServer,
  BridgeVerbContract,
  BridgeVerbDefinition,
  BridgeVerbHandler,
  BridgeVerbRegistration,
  CreateBridgeServerOptions
} from './server'

export { iframeClientTransport, parentServerTransport } from './dom-transport'
export type { IframeClientTransportOptions, ParentServerTransportOptions } from './dom-transport'
