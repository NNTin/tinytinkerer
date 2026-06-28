import { APP_BRIDGE_PROTOCOL_VERSION, bridgeMessageSchema } from './protocol'
import type { BridgeTransport } from './transport'
import type { ZodType } from 'zod'

// A verb handler runs inside the iframe app and maps a request payload to a
// result (or throws to signal failure). It may be sync or async — the server
// awaits the return value either way. Schema-bearing definitions are parsed by
// the server first; function-only handlers receive unknown payloads. (The result
// type is `unknown` because it already absorbs promises.)
export type BridgeVerbHandler = (payload: unknown) => unknown

export type BridgeVerbContract<TInput, TResult> = {
  inputSchema: ZodType<TInput>
  resultSchema: ZodType<TResult>
}

const bridgeVerbDefinitionBrand: unique symbol = Symbol('app-bridge-verb-definition')

export type BridgeVerbDefinition = {
  readonly [bridgeVerbDefinitionBrand]: true
  inputSchema: ZodType
  resultSchema: ZodType
  handler: BridgeVerbHandler
}

export type BridgeVerbRegistration = BridgeVerbHandler | BridgeVerbDefinition

// Bind an app-owned input/result contract to its handler once. The generic
// contract gives app code inferred payload/result types; the bridge keeps the
// only necessary unknown→typed cast at this boundary and validates both sides
// of the handler before anything crosses the wire.
export const defineBridgeVerb = <TInput, TResult>(
  contract: BridgeVerbContract<TInput, TResult>,
  handler: (payload: TInput) => TResult | Promise<TResult>
): BridgeVerbDefinition => ({
  [bridgeVerbDefinitionBrand]: true,
  inputSchema: contract.inputSchema,
  resultSchema: contract.resultSchema,
  handler: (payload) => handler(payload as TInput)
})

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
  // Generic bridge envelope version. Override only in compatibility tests.
  protocolVersion?: number
  // Independently versioned app-owned contract advertised in the handshake.
  appProtocolVersion: number
  // The per-mount nonce (passed from the harness, e.g. via the iframe URL hash).
  sessionNonce: string
  // verb → legacy handler or defineBridgeVerb result. Keys are advertised in the
  // handshake; app-owned verbs should always use the validated definition form.
  handlers: Record<string, BridgeVerbRegistration>
}

export const createBridgeServer = (
  transport: BridgeTransport,
  options: CreateBridgeServerOptions
): BridgeServer => {
  const verbs = Object.keys(options.handlers)
  const protocolVersion = options.protocolVersion ?? APP_BRIDGE_PROTOCOL_VERSION

  const announceReady = (): void => {
    transport.post({
      kind: 'ready',
      appId: options.appId,
      protocolVersion,
      appProtocolVersion: options.appProtocolVersion,
      sessionNonce: options.sessionNonce,
      verbs
    })
  }

  const emit = (verb: string, payload?: unknown): void => {
    transport.post({
      kind: 'event',
      verb,
      payload: payload ?? null,
      protocolVersion,
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
    if (message.protocolVersion !== protocolVersion) return

    const reply = (body: { ok: true; result: unknown } | { ok: false; error: string }): void => {
      transport.post({
        kind: 'res',
        id: message.id,
        protocolVersion,
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
    // bridge error response and the handler is never invoked. Every error string
    // is non-empty so the reply satisfies the wire schema instead of being dropped
    // and leaving the request to hang until its timeout.
    void (async () => {
      try {
        const payload =
          'inputSchema' in definition
            ? definition.inputSchema.parse(message.payload)
            : message.payload
        const result = await definition.handler(payload)
        const validatedResult =
          'resultSchema' in definition ? definition.resultSchema.parse(result) : result
        reply({ ok: true, result: validatedResult ?? null })
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error)
        reply({ ok: false, error: text || `app-bridge: verb "${message.verb}" failed` })
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
