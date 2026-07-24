import { createContext, useContext } from 'react'

// The standardized LiveLab state machine (issue #451). Every LiveLab/LiveSessionGate
// on every page renders from exactly one of these, so a visitor sees the same
// vocabulary everywhere:
//   loading       - the isolated docs session is still bootstrapping
//   signed-out    - no TinyTinkerer auth token was found for this browser
//   ready         - signed in, session hydrated, no call in flight
//   running       - a live call is in flight
//   rate-limited  - the last call hit the model service's cooldown
//   error         - the session failed to initialize, or the last action threw
//   reset         - a LabReset just cleared the isolated docs session
export type LabSessionStatus =
  | 'loading'
  | 'signed-out'
  | 'ready'
  | 'running'
  | 'rate-limited'
  | 'error'
  | 'reset'

export type LabSessionSnapshot = {
  status: LabSessionStatus
  // Present only when status is 'error'.
  error: string | null
  // Present only when status is 'rate-limited': ISO timestamp the cooldown ends.
  retryAt: string | null
}

export const LOADING_SNAPSHOT: LabSessionSnapshot = {
  status: 'loading',
  error: null,
  retryAt: null
}

// Pure state-machine transition (issue #451: standardized loading/signed-out/
// ready/running/rate-limited/error/reset states), extracted so it can be unit
// tested without mounting the product runtime. Precedence matters: a reset in
// flight or an active cooldown overrides whatever the auth/run state would
// otherwise say.
export const deriveLabSessionSnapshot = (input: {
  isResetting: boolean
  isCoolingDown: boolean
  cooldownUntil: string | null
  isRunning: boolean
  token: string | null
}): LabSessionSnapshot => {
  if (input.isResetting) {
    return { status: 'reset', error: null, retryAt: null }
  }
  if (input.isCoolingDown) {
    return { status: 'rate-limited', error: null, retryAt: input.cooldownUntil }
  }
  if (input.isRunning) {
    return { status: 'running', error: null, retryAt: null }
  }
  if (!input.token) {
    return { status: 'signed-out', error: null, retryAt: null }
  }
  return { status: 'ready', error: null, retryAt: null }
}

export type LabSessionContextValue = {
  snapshot: LabSessionSnapshot
  // Sends the visitor to the existing app's GitHub login, returning them to this
  // docs URL afterwards. No-ops outside the browser.
  signIn: () => void
  // Clears the isolated docs-only session (conversations, plugin settings, model
  // selection) and reloads. Never touches the main product's database or token.
  reset: () => Promise<void>
}

export const LabSessionContext = createContext<LabSessionContextValue | undefined>(undefined)

// Internal, lenient accessor for the framework's own gate/reset components: they
// must render safely (as `null`) when used outside a <LiveLab>, including during
// static rendering, rather than throwing.
export const useLabSessionContextOptional = (): LabSessionContextValue | undefined =>
  useContext(LabSessionContext)

// Public hook for lab content (mounted inside <LiveSessionGate>, therefore only
// ever rendered once the session is ready) to read the live session and drive its
// own calls via the normal product hooks (useChatStore, useSettingsStore, ...).
export const useLabSession = (): LabSessionContextValue => {
  const value = useLabSessionContextOptional()
  if (!value) {
    throw new Error('useLabSession must be used within a <LiveLab> boundary.')
  }
  return value
}
