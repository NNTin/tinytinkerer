import { useGitHubOAuth } from '@tinytinkerer/app-browser'
import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

export const CallbackPage = () => {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const { completeGitHubOAuthCallback } = useGitHubOAuth()

  useEffect(() => {
    completeGitHubOAuthCallback({
      code: searchParams.get('code'),
      state: searchParams.get('state')
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
  }, [completeGitHubOAuthCallback, navigate, searchParams])

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-rose-600">{error}</p>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center">
      <p className="text-sm text-stone-500">Completing sign in…</p>
    </div>
  )
}
