import { fetchWithTimeout } from './fetch'
import type { Bindings } from './bindings'
import { deriveCredentialKey } from './rate-limit'
import {
  readCachedCallerValidation,
  writeCachedCallerValidation
} from './caller-validation-cache'

export type CallerIdentity = {
  id: string
  login: string
}

export type CallerValidationResult =
  | { status: 'valid'; identity: CallerIdentity }
  | { status: 'invalid' }
  | { status: 'forbidden'; identity: CallerIdentity }
  | { status: 'unavailable' }

// api.github.com (the core REST API) rejects requests without a User-Agent with
// a 403 ("Request forbidden by administrative rules ... User-Agent header
// required"). Cloudflare Workers' `fetch` does not set one, so the caller-
// validation probe below must send it explicitly or EVERY call 403s and is
// mis-read as an invalid caller -> a spurious 401 (TINYTINKERER-FRONTEND-N/P/Q/R).
const GITHUB_API_USER_AGENT = 'tinytinkerer-edge'

const parseGitHubIdentity = async (
  response: Response
): Promise<CallerIdentity | undefined> => {
  const raw = (await response.json().catch(() => undefined)) as
    | Record<string, unknown>
    | undefined
  const rawId = raw?.id
  const login = typeof raw?.login === 'string' ? raw.login.trim() : ''
  const id =
    typeof rawId === 'number' && Number.isFinite(rawId)
      ? String(rawId)
      : typeof rawId === 'string'
        ? rawId.trim()
        : ''
  return id && login ? { id, login } : undefined
}

const allowedCallerSet = (env: Pick<Bindings, 'GITHUB_ALLOWED_USERS'>): Set<string> =>
  new Set(
    (env.GITHUB_ALLOWED_USERS ?? '')
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean)
  )

const isCallerAllowed = (
  identity: CallerIdentity,
  env: Pick<Bindings, 'GITHUB_ALLOWED_USERS'>
): boolean => {
  const allowed = allowedCallerSet(env)
  if (allowed.size === 0) return true
  return allowed.has(identity.id.toLowerCase()) || allowed.has(identity.login.toLowerCase())
}

/**
 * Validate the caller's GitHub identity by probing `api.github.com/user` with
 * the supplied Authorization header. Shared by every route that spends a
 * server-side resource on the caller's behalf — the model proxy (per-user
 * LiteLLM virtual key provisioned by the edge), the search proxy (shared Tavily
 * key), and the MCP proxy (outbound fetch) — so a merely well-formed
 * Authorization header is never enough to use those resources.
 *
 * A successful validation is cached (short TTL, positive results only) so a
 * ReAct prompt that fans out into several edge calls does not pay the GitHub
 * round trip — or burn the caller's GitHub rate limit — on every call (issue
 * #177). `invalid` and `unavailable` are never cached, so revocation bites
 * within minutes and a GitHub outage is never sticky.
 */
export const validateLiteLLMCaller = async (
  authorization: string,
  env: Pick<Bindings, 'GITHUB_ALLOWED_USERS'> = {}
): Promise<CallerValidationResult> => {
  const callerKey = await deriveCredentialKey(authorization)
  const cached = await readCachedCallerValidation(callerKey)
  if (cached) {
    return isCallerAllowed(cached, env)
      ? { status: 'valid', identity: cached }
      : { status: 'forbidden', identity: cached }
  }

  const response = await fetchWithTimeout(
    {
      area: 'models.litellm.auth',
      origin: 'github',
      method: 'GET',
      url: 'https://api.github.com/user',
      accept: {
        status: [401, 403],
        reason:
          'Expected GitHub token rejection while validating a caller before using a shared server-side resource (LiteLLM key, Tavily key, or the MCP proxy).'
      }
    },
    {
      headers: {
        authorization,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2026-03-10',
        'user-agent': GITHUB_API_USER_AGENT
      }
    },
    10_000
  ).catch(() => undefined)

  if (!response) return { status: 'unavailable' }
  if (response.ok) {
    const identity = await parseGitHubIdentity(response)
    if (!identity) return { status: 'unavailable' }
    await writeCachedCallerValidation(callerKey, identity)
    return isCallerAllowed(identity, env)
      ? { status: 'valid', identity }
      : { status: 'forbidden', identity }
  }
  if (response.status === 401 || response.status === 403) return { status: 'invalid' }
  return { status: 'unavailable' }
}
