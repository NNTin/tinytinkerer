import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { exchangeCode } from '../../services/auth'
import { useAuthStore } from '../../stores/auth-store'

export const CallbackPage = () => {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const setToken = useAuthStore((state) => state.setToken)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const code = searchParams.get('code')
    if (!code) {
      setError('No authorization code received from GitHub.')
      return
    }

    exchangeCode(code)
      .then(async (token) => {
        await setToken(token)
        void navigate('/', { replace: true })
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Authentication failed.')
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
