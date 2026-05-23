import { buildGitHubLoginUrl as _buildGitHubLoginUrl, validateOAuthState, exchangeCode as _exchangeCode } from '@tinytinkerer/app-browser'
import { edgeUrl } from './config.js'

export { validateOAuthState }

export const buildGitHubLoginUrl = (): string | null => {
  const clientId = import.meta.env.VITE_GITHUB_CLIENT_ID
  const redirectUri = import.meta.env.VITE_GITHUB_REDIRECT_URI
  return _buildGitHubLoginUrl({
    ...(clientId ? { clientId } : {}),
    ...(redirectUri ? { redirectUri } : {})
  })
}

export const exchangeCode = (code: string): Promise<string> => {
  const redirectUri = import.meta.env.VITE_GITHUB_REDIRECT_URI
  return _exchangeCode(code, {
    edgeBaseUrl: edgeUrl,
    ...(redirectUri ? { redirectUri } : {})
  })
}
