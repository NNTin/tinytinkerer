import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { exchangeCode, validateOAuthState } from '../../services/auth'
import { useAuthStore } from '../../stores/auth-store'

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
  }, [searchParams, navigate, setToken])

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
