import { useEffect, useState } from 'react'
import { useAuthStore } from './app'
import {
  captureRequestIssue,
  fetchWithTelemetry,
  parseJsonWithTelemetry,
  type RequestTelemetryMetadata
} from './telemetry/request-telemetry'

export type GitHubUser = {
  login: string
  name: string | null
  avatarUrl: string
}

const githubUserCache = new Map<string, GitHubUser>()

export const fetchGitHubUser = async (
  token: string,
  onUnauthorized?: () => void
): Promise<GitHubUser | null> => {
  // Gate on GitHub auth state: never probe the authenticated /user endpoint
  // without a real token. A blank token guarantees a 401, so short-circuit
  // before the request is made (TINYTINKERER-FRONTEND-4).
  if (!token.trim()) {
    return null
  }

  const cached = githubUserCache.get(token)
  if (cached) {
    return cached
  }

  const metadata: RequestTelemetryMetadata = {
    area: 'github.user',
    origin: 'github',
    method: 'GET',
    url: 'https://api.github.com/user',
    // Reaching a third-party host (api.github.com) over the public internet can
    // transiently fail (offline, DNS, GitHub edge blip). That network failure is
    // normal & unavoidable and not our bug. We still capture http_error so a real
    // 401/4xx/5xx from GitHub keeps surfacing (the 401 path clears the token).
    accept: {
      kinds: ['network_error'],
      reason:
        'Background user fetch to api.github.com; transient client-side network failure is expected (TINYTINKERER-FRONTEND-7).'
    }
  }

  try {
    const response = await fetchWithTelemetry(metadata, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json' }
    })

    if (!response.ok) {
      // A 401 means the (persisted) token is invalid/expired/revoked. Signal the
      // caller so it can drop the bad token instead of re-probing /user on every
      // mount, which produced the repeated 401s in TINYTINKERER-FRONTEND-4.
      if (response.status === 401) {
        onUnauthorized?.()
      }
      return null
    }

    const data = await parseJsonWithTelemetry<Record<string, unknown>>(metadata, response)
    const user: GitHubUser = {
      login: typeof data['login'] === 'string' ? data['login'] : '',
      name: typeof data['name'] === 'string' ? data['name'] : null,
      avatarUrl: typeof data['avatar_url'] === 'string' ? data['avatar_url'] : ''
    }

    if (user.login) {
      githubUserCache.set(token, user)
    }

    if (!user.login) {
      captureRequestIssue(metadata, {
        kind: 'schema_error',
        message: 'GitHub user response did not include a login',
        response
      })
      return null
    }

    return user
  } catch {
    return null
  }
}

export const useGitHubUser = (): GitHubUser | null => {
  const token = useAuthStore((state) => state.token)
  const clearToken = useAuthStore((state) => state.clearToken)
  const [user, setUser] = useState<GitHubUser | null>(null)

  useEffect(() => {
    if (!token) {
      setUser(null)
      return
    }

    void fetchGitHubUser(token, () => {
      // Drop the rejected token so we transition to the unauthenticated state
      // and stop re-probing /user with a credential GitHub has refused.
      void clearToken()
    }).then(setUser)
  }, [token, clearToken])

  return user
}
