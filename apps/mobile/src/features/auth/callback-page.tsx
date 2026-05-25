import { useGitHubOAuthCallbackController } from '@tinytinkerer/app-browser'
import { useNavigate } from 'react-router-dom'

export const CallbackPage = () => {
  const navigate = useNavigate()
  const { error } = useGitHubOAuthCallbackController(() => {
    void navigate('/', { replace: true })
  })

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
