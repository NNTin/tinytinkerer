import { useGitHubOAuthCallbackController } from '@tinytinkerer/app-browser'
import { useNavigate } from 'react-router-dom'

export const CallbackPage = () => {
  const navigate = useNavigate()
  const { error } = useGitHubOAuthCallbackController(() => {
    void navigate('/', { replace: true })
  })

  return (
    <div className="flex min-h-screen items-center justify-center text-sm text-[var(--widget-muted)]">
      {error ?? 'Completing sign in...'}
    </div>
  )
}
