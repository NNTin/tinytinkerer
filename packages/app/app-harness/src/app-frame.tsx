import { useCallback, useEffect, useRef, useState } from 'react'
import {
  BridgeVersionMismatchError,
  createBridgeClient,
  iframeClientTransport
} from '@tinytinkerer/app-bridge'
import type { AppBridgeHandle } from './bridge-handle'

export type AppFrameStatus = 'loading' | 'ready' | 'version-mismatch' | 'error'

export type AppFrameProps = {
  // The iframe app page, served under its harness route (e.g. "/canvas/excalidraw-app/").
  src: string
  // The id the harness expects the app to announce; pins the handshake.
  appId: string
  // The protocol version the harness speaks; the app is gated on it.
  protocolVersion: number
  // Capabilities this shell exposes as tools. The handshake must advertise all
  // of them before the handle becomes ready.
  expectedVerbs: readonly string[]
  // The shared handle the always-on appTools call through. MUST be stable across
  // renders (create it once, e.g. module-level or via useRef) — it is an effect
  // dependency. <AppFrame> populates it on ready / clears it on teardown.
  handle: AppBridgeHandle
  title: string
  className?: string
  // How long to wait for the app's ready handshake before reporting 'error'.
  readyTimeoutMs?: number
  onStatusChange?: (status: AppFrameStatus) => void
}

// The harness passes its per-mount session nonce to the app through the iframe URL
// fragment (a fragment is never sent to the server, and the sandboxed app reads it
// from location.hash). The app echoes it on every message so the two instances stay
// paired over the opaque origin.
export const APP_BRIDGE_NONCE_PARAM = 'app-bridge-nonce'

const appendSessionNonce = (src: string, nonce: string): string => {
  const separator = src.includes('#') ? '&' : '#'
  return `${src}${separator}${APP_BRIDGE_NONCE_PARAM}=${encodeURIComponent(nonce)}`
}

export const AppFrame = ({
  src,
  appId,
  protocolVersion,
  expectedVerbs,
  handle,
  title,
  className,
  readyTimeoutMs = 20_000,
  onStatusChange
}: AppFrameProps): React.JSX.Element => {
  const frameRef = useRef<HTMLIFrameElement | null>(null)
  const nonceRef = useRef<string>('')
  if (nonceRef.current === '') nonceRef.current = crypto.randomUUID()
  const [status, setStatus] = useState<AppFrameStatus>('loading')

  // Track the latest onStatusChange without making it an effect dependency (it is
  // often an inline arrow that would otherwise re-run the bridge effect each render).
  const onStatusChangeRef = useRef(onStatusChange)
  onStatusChangeRef.current = onStatusChange

  const report = useCallback((next: AppFrameStatus): void => {
    setStatus(next)
    onStatusChangeRef.current?.(next)
  }, [])

  useEffect(() => {
    const frame = frameRef.current
    if (!frame) return
    let cancelled = false

    const client = createBridgeClient(iframeClientTransport(frame), {
      protocolVersion,
      sessionNonce: nonceRef.current,
      expectedAppId: appId,
      expectedVerbs
    })

    const readyTimer = setTimeout(() => {
      if (cancelled) return
      handle.setUnavailable(`app "${appId}" did not become ready within ${readyTimeoutMs}ms`)
      report('error')
    }, readyTimeoutMs)

    client.ready.then(
      () => {
        if (cancelled) return
        clearTimeout(readyTimer)
        handle.setClient(client)
        report('ready')
      },
      (error: unknown) => {
        if (cancelled) return
        clearTimeout(readyTimer)
        handle.setUnavailable(error instanceof Error ? error.message : String(error))
        report(error instanceof BridgeVersionMismatchError ? 'version-mismatch' : 'error')
      }
    )

    return () => {
      cancelled = true
      clearTimeout(readyTimer)
      handle.setClient(null)
      client.dispose()
    }
  }, [src, appId, protocolVersion, expectedVerbs, handle, readyTimeoutMs, report])

  return (
    <iframe
      ref={frameRef}
      src={appendSessionNonce(src, nonceRef.current)}
      title={title}
      className={className}
      // Opaque-origin isolation: the app runs scripts but has no same-origin access
      // to the harness (storage, cookies, DOM). The bridge correlates by event.source
      // + session nonce instead of origin (see app-bridge dom-transport.ts).
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      data-app-frame-status={status}
    />
  )
}
