import { useState, type ReactNode } from 'react'
import { FaGithub } from 'react-icons/fa6'
import { useAppSignIn } from '../hooks'

/**
 * What a signed-out `ChatApp` shows when its app requires sign-in
 * (`authMode: 'oauth'`, see `isSignInRequired`) — in place of the whole chat
 * body, not just the composer. The bodies are what talk to the edge (status
 * polling, the model catalogue, MCP discovery, the run itself), so leaving them
 * unmounted is what guarantees a signed-out reader sends the edge nothing.
 */
const SignInRequiredPanel = (): ReactNode => {
  const { canSignIn, signIn } = useAppSignIn()
  const [unavailable, setUnavailable] = useState(false)

  return (
    <section
      aria-label="Sign in required"
      className="flex h-full min-h-0 flex-1 flex-col items-center justify-center gap-3 bg-[var(--panel)] px-6 py-8 text-center text-[var(--text)]"
    >
      <h2 className="text-sm font-semibold text-[var(--text-strong)]">
        Sign in to use the assistant
      </h2>
      <p className="max-w-xs text-xs text-[var(--muted)]">
        This assistant needs a GitHub account. Requests use your own budget and rate limits.
      </p>
      {canSignIn ? (
        <button
          type="button"
          onClick={() => setUnavailable(!signIn())}
          className="inline-flex items-center gap-2 rounded-md border border-[var(--text-strong)] bg-[var(--text-strong)] px-4 py-2 text-sm text-[var(--panel)] transition-opacity hover:opacity-90"
        >
          <FaGithub className="h-4 w-4" aria-hidden="true" />
          Sign in with GitHub
        </button>
      ) : null}
      {unavailable || !canSignIn ? (
        <p role="alert" className="text-xs text-rose-600">
          Sign-in is unavailable in this deployment.
        </p>
      ) : null}
    </section>
  )
}

// Default export: the panel is only ever reached through `lazy()` (chat-app.tsx).
export default SignInRequiredPanel
