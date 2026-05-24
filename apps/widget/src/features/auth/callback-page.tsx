import { useGitHubOAuth } from '@tinytinkerer/app-browser'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

export const CallbackPage = () => {
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const { completeGitHubOAuthCallback } = useGitHubOAuth()

  useEffect(() => {
    // GitHub redirects to /?code=...&state=...#/auth/callback — params land in
    // window.location.search, not in the hash, so useSearchParams() returns empty.
    const params = new URLSearchParams(window.location.search)
    completeGitHubOAuthCallback({
      code: params.get('code'),
      state: params.get('state')
    })
      .then(() => {
        void navigate('/', { replace: true })
      })
      .catch((nextError: unknown) => {
        setError(
          nextError instanceof Error && nextError.message
            ? nextError.message
            : 'Authentication failed. Please try again.'
        )
      })
  }, [completeGitHubOAuthCallback, navigate])

  return (
    <div className="flex min-h-screen items-center justify-center text-sm text-[var(--widget-muted)]">
      {error ?? 'Completing sign in...'}
    </div>
  )
}
