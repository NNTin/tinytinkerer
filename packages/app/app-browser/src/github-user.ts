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
// Tokens GitHub has already rejected with a 401. Gating on token *presence*
// alone (PR #100) wasn't enough: a persisted-but-expired token still probed
// /user. Worse, two surfaces (consent-gate + the app shell) mount together and
// each probed the SAME stale token before the store cleared it, so every load
// captured ~2 fresh 401s — that is the FRONTEND-4 regression (two events ~1s
// apart per load). Remembering a rejected token lets later callers short-circuit
// on validity, not just presence.
const rejectedTokens = new Set<string>()
// In-flight probes keyed by token, so concurrent callers share one request (and
// thus one capture) instead of each firing their own.
const inFlightProbes = new Map<string, Promise<GitHubUser | null>>()

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

  // Validity gate: a token we already saw GitHub reject is known-bad. Never
  // re-probe it (that re-probe is what FRONTEND-4 kept capturing); re-signal the
  // caller so it drops the token if it is somehow still holding it.
  if (rejectedTokens.has(token)) {
    onUnauthorized?.()
    return null
  }

  // Collapse concurrent callers (the two surfaces mount in the same tick) onto a
  // single probe so a stale token is requested — and captured — at most once.
  const inFlight = inFlightProbes.get(token)
  if (inFlight) {
    return inFlight
  }
  const probe = probeGitHubUser(token, onUnauthorized).finally(() => {
    inFlightProbes.delete(token)
  })
  inFlightProbes.set(token, probe)
  return probe
}

const probeGitHubUser = async (
  token: string,
  onUnauthorized?: () => void
): Promise<GitHubUser | null> => {
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
      // A 401 means the (persisted) token is invalid/expired/revoked. Remember it
      // so no later caller re-probes it, and signal the caller to drop it —
      // together these stop the repeated /user 401s in TINYTINKERER-FRONTEND-4.
      if (response.status === 401) {
        rejectedTokens.add(token)
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
