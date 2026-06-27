import { bridgeMessageSchema } from './protocol'
import type { BridgeTransport } from './transport'
import type { ZodType } from 'zod'

// A verb handler runs inside the iframe app and maps a request payload to a
// result (or throws to signal failure). It may be sync or async — the server
// awaits the return value either way. Schema-bearing definitions are parsed by
// the server first; function-only handlers receive unknown payloads. (The result
// type is `unknown` because it already absorbs promises.)
export type BridgeVerbHandler = (payload: unknown) => unknown

// Apps may attach their app-owned payload schema to a verb. The bridge validates
// before invoking the handler so malformed payloads can never reach app logic.
// Function-only handlers remain supported for generic/legacy callers.
export type BridgeVerbDefinition = {
  inputSchema?: ZodType
  handler: BridgeVerbHandler
}

export type BridgeVerbRegistration = BridgeVerbHandler | BridgeVerbDefinition

export type BridgeServer = {
  // Re-announce readiness. Called once automatically on creation; exposed so an
  // app can re-handshake if it remounts.
  announceReady(): void
  // Send an unsolicited event to the harness (e.g. "scene-changed").
  emit(verb: string, payload?: unknown): void
  // Stop listening for requests.
  dispose(): void
}

export type CreateBridgeServerOptions = {
  // Identifies this app in the handshake; the harness can pin it via expectedAppId.
  appId: string
  // The version this app speaks; the harness gates on it.
  protocolVersion: number
  // The per-mount nonce (passed from the harness, e.g. via the iframe URL hash).
  sessionNonce: string
  // verb → handler/definition. The set of keys is advertised in the handshake.
  handlers: Record<string, BridgeVerbRegistration>
}

export const createBridgeServer = (
  transport: BridgeTransport,
  options: CreateBridgeServerOptions
): BridgeServer => {
  const verbs = Object.keys(options.handlers)

  const announceReady = (): void => {
    transport.post({
      kind: 'ready',
      appId: options.appId,
      protocolVersion: options.protocolVersion,
      sessionNonce: options.sessionNonce,
      verbs
    })
  }

  const emit = (verb: string, payload?: unknown): void => {
    transport.post({
      kind: 'event',
      verb,
      payload: payload ?? null,
      protocolVersion: options.protocolVersion,
      sessionNonce: options.sessionNonce
    })
  }

  const unsubscribe = transport.subscribe((raw) => {
    const parsed = bridgeMessageSchema.safeParse(raw)
    if (!parsed.success) return
    const message = parsed.data
    if (message.sessionNonce !== options.sessionNonce) return
    // A late-joining harness client asks us to re-announce; oblige.
    if (message.kind === 'hello') {
      announceReady()
      return
    }
    if (message.kind !== 'req') return

    const reply = (body: { ok: true; result: unknown } | { ok: false; error: string }): void => {
      transport.post({
        kind: 'res',
        id: message.id,
        protocolVersion: options.protocolVersion,
        sessionNonce: options.sessionNonce,
        ...body
      })
    }

    const registration = options.handlers[message.verb]
    if (!registration) {
      reply({ ok: false, error: `app-bridge: unknown verb "${message.verb}"` })
      return
    }

    const definition = typeof registration === 'function' ? { handler: registration } : registration

    // Parse before entering app code. Zod errors are returned through the normal
    // bridge error response and the handler is never invoked.
    void (async () => {
      try {
        const payload = definition.inputSchema
          ? definition.inputSchema.parse(message.payload)
          : message.payload
        const result = await definition.handler(payload)
        reply({ ok: true, result: result ?? null })
      } catch (error) {
        reply({ ok: false, error: error instanceof Error ? error.message : String(error) })
      }
    })()
  })

  const dispose = (): void => {
    unsubscribe()
  }

  // Announce readiness immediately. The harness attaches its listener at mount —
  // before the iframe document loads — so this first handshake is not missed.
  announceReady()

  return { announceReady, emit, dispose }
}
