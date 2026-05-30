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

export const fetchGitHubUser = async (token: string): Promise<GitHubUser | null> => {
  const cached = githubUserCache.get(token)
  if (cached) {
    return cached
  }

  const metadata: RequestTelemetryMetadata = {
    area: 'github.user',
    origin: 'github',
    method: 'GET',
    url: 'https://api.github.com/user'
  }

  try {
    const response = await fetchWithTelemetry(metadata, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json' }
    })

    if (!response.ok) {
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
  const [user, setUser] = useState<GitHubUser | null>(null)

  useEffect(() => {
    if (!token) {
      setUser(null)
      return
    }

    void fetchGitHubUser(token).then(setUser)
  }, [token])

  return user
}
