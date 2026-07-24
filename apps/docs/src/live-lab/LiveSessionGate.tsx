import type { ReactNode } from 'react'
import { useLabSessionContextOptional, type LabSessionSnapshot } from './lab-session-context'

export type LiveSessionGateProps = {
  children: ReactNode
  // Optional per-status overrides; every status otherwise gets a sensible
  // built-in fallback so a lab author can drop <LiveSessionGate> in with zero
  // configuration.
  loading?: ReactNode
  signedOut?: ReactNode
  rateLimited?: ReactNode
  error?: ReactNode
  reset?: ReactNode
}

const formatRetryAt = (retryAt: string | null): string => {
  if (!retryAt) {
    return 'shortly'
  }
  const parsed = Date.parse(retryAt)
  if (Number.isNaN(parsed)) {
    return 'shortly'
  }
  const seconds = Math.max(0, Math.round((parsed - Date.now()) / 1000))
  return seconds > 0 ? `in about ${seconds}s` : 'shortly'
}

const DefaultFallback = ({ snapshot }: { snapshot: LabSessionSnapshot }) => {
  switch (snapshot.status) {
    case 'loading':
      return <p role="status">Loading the live lab session…</p>
    case 'signed-out':
      return <p role="status">Sign in to TinyTinkerer to run this lab.</p>
    case 'rate-limited':
      return (
        <p role="status">
          The model service is rate limited. Try again {formatRetryAt(snapshot.retryAt)}.
        </p>
      )
    case 'error':
      return <p role="alert">{snapshot.error ?? 'Something went wrong starting this lab.'}</p>
    case 'reset':
      return <p role="status">Resetting the lab session…</p>
    default:
      return null
  }
}

// Standardizes the loading/signed-out/rate-limited/error/reset states (issue #451)
// so every lab on the site presents them identically; only renders `children` —
// the actual live content — once the shared docs session is 'ready' or 'running'.
export const LiveSessionGate = ({
  children,
  loading,
  signedOut,
  rateLimited,
  error,
  reset
}: LiveSessionGateProps) => {
  const context = useLabSessionContextOptional()

  // Outside a <LiveLab> boundary (including during static rendering): render
  // nothing rather than throwing, so a misplaced <LiveSessionGate> fails soft.
  if (!context) {
    return null
  }

  const { snapshot } = context
  if (snapshot.status === 'ready' || snapshot.status === 'running') {
    return <>{children}</>
  }

  const overrides: Partial<Record<typeof snapshot.status, ReactNode>> = {
    loading,
    'signed-out': signedOut,
    'rate-limited': rateLimited,
    error,
    reset
  }

  const signInAction =
    snapshot.status === 'signed-out' ? (
      <button type="button" className="live-lab__sign-in" onClick={context.signIn}>
        Sign in with GitHub
      </button>
    ) : null

  return (
    <div className="live-lab__gate" data-lab-status={snapshot.status}>
      {overrides[snapshot.status] ?? <DefaultFallback snapshot={snapshot} />}
      {signInAction}
    </div>
  )
}
