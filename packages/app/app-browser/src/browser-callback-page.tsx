import { useGitHubOAuthCallbackController } from './surfaces'
import { useNavigate } from 'react-router-dom'

export const BrowserCallbackPage = () => {
  const navigate = useNavigate()
  const { error } = useGitHubOAuthCallbackController(() => {
    void navigate('/', { replace: true })
  })

  if (error) {
    // Keep the failure visible and actionable instead of a dead-end message the
    // user would otherwise be stranded on. The underlying failure is also
    // captured to Sentry (issue #409) so it can be diagnosed after the fact.
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3">
        <p className="text-sm text-rose-600">{error}</p>
        <button
          type="button"
          className="text-sm text-stone-500 underline underline-offset-2 hover:text-stone-700"
          onClick={() => void navigate('/', { replace: true })}
        >
          Back to sign in
        </button>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center">
      <p className="text-sm text-stone-500">Completing sign in…</p>
    </div>
  )
}
