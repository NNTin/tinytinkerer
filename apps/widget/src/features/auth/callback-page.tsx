import { completeGitHubOAuthCallback } from '@tinytinkerer/app-browser'
import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

export const CallbackPage = () => {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)

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
  }, [navigate, searchParams])

  return (
    <div className="flex min-h-screen items-center justify-center text-sm text-[var(--widget-muted)]">
      {error ?? 'Completing sign in...'}
    </div>
  )
}
