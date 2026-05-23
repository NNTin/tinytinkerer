import { exchangeCode, useAuthStore, validateOAuthState } from '@tinytinkerer/app-browser'
import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

export const CallbackPage = () => {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const setToken = useAuthStore((state) => state.setToken)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const code = searchParams.get('code')
    const state = searchParams.get('state')

    if (!code) {
      setError('No authorization code received from GitHub.')
      return
    }

    if (!validateOAuthState(state)) {
      setError('Authentication failed. Please try signing in again.')
      return
    }

    exchangeCode(code)
      .then(async (token) => {
        await setToken(token)
        void navigate('/', { replace: true })
      })
      .catch(() => {
        setError('Authentication failed. Please try again.')
      })
  }, [navigate, searchParams, setToken])

  return (
    <div className="flex min-h-screen items-center justify-center text-sm text-[var(--widget-muted)]">
      {error ?? 'Completing sign in...'}
    </div>
  )
}
