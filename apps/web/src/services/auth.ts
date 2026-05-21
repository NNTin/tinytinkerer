import { z } from 'zod'
import { edgeUrl } from './config'

const exchangeResponseSchema = z.object({
  accessToken: z.string().optional(),
  error: z.string().optional()
})

export const buildGitHubLoginUrl = (): string | null => {
  const clientId = import.meta.env.VITE_GITHUB_CLIENT_ID
  if (!clientId) return null

  const params = new URLSearchParams({ client_id: clientId, scope: 'read:user' })
  const redirectUri = import.meta.env.VITE_GITHUB_REDIRECT_URI
  if (redirectUri) params.set('redirect_uri', redirectUri)

  return `https://github.com/login/oauth/authorize?${params.toString()}`
}

export const exchangeCode = async (code: string): Promise<string> => {
  const redirectUri = import.meta.env.VITE_GITHUB_REDIRECT_URI
  const response = await fetch(`${edgeUrl}/auth/github/exchange`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, ...(redirectUri ? { redirectUri } : {}) })
  })

  if (!response.ok) {
    throw new Error('OAuth exchange failed')
  }

  const data = exchangeResponseSchema.parse(await response.json())
  if (!data.accessToken) {
    throw new Error(data.error ?? 'No access token in response')
  }

  return data.accessToken
}
