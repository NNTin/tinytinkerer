import { useEffect, useState } from 'react'
import { useAuthStore } from './app'

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

  try {
    const response = await fetch('https://api.github.com/user', {
      headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json' }
    })

    if (!response.ok) {
      return null
    }

    const data = (await response.json()) as Record<string, unknown>
    const user: GitHubUser = {
      login: typeof data['login'] === 'string' ? data['login'] : '',
      name: typeof data['name'] === 'string' ? data['name'] : null,
      avatarUrl: typeof data['avatar_url'] === 'string' ? data['avatar_url'] : ''
    }

    if (user.login) {
      githubUserCache.set(token, user)
    }

    return user.login ? user : null
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
