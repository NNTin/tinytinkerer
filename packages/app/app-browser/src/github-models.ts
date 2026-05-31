import { useEffect, useState } from 'react'
import { SUPPORTED_MODELS } from '@tinytinkerer/app-core'
import { modelsListResponseSchema, type GitHubModelEntry } from '@tinytinkerer/contracts'
import { useAuthStore } from './app'
import { useBrowserShellConfig } from './hooks'
import { getTelemetryHeaders } from './telemetry/telemetry'
import {
  captureRequestIssue,
  fetchWithTelemetry,
  parseJsonWithTelemetry,
  type RequestTelemetryMetadata
} from './telemetry/request-telemetry'

export type ModelEntry = GitHubModelEntry

type CacheEntry = { models: ModelEntry[]; cachedAt: number; ttlMs: number }
const modelsCache = new Map<string, CacheEntry>()
const MODELS_CACHE_TTL_MS = 5 * 60_000
// Brief negative cache: when a list fetch fails (e.g. the edge is rate limited),
// don't re-probe — and re-report the failure — on every component remount. The
// edge already serves a cached catalogue, so a short window here is enough to
// stop the frontend hammering it during a rate-limit storm (TINYTINKERER-FRONTEND-5).
const MODELS_FALLBACK_TTL_MS = 30_000

/** Reset the in-memory models cache. Test-only — the cache is module-level. */
export const clearModelsCache = (): void => modelsCache.clear()

const hashToken = async (token: string): Promise<string> => {
  const data = new TextEncoder().encode(token)
  const hash = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export const fetchGitHubModels = async (
  edgeBaseUrl: string,
  token: string
): Promise<ModelEntry[]> => {
  const tokenHash = await hashToken(token)
  const cacheKey = `${edgeBaseUrl}:${tokenHash}`
  const cached = modelsCache.get(cacheKey)
  if (cached && Date.now() - cached.cachedAt <= cached.ttlMs) return cached.models

  // Cache the fallback briefly so rapid remounts during a rate-limit storm
  // don't re-fetch (and re-report) the list every time.
  const fallback = (): ModelEntry[] => {
    const models = [...SUPPORTED_MODELS]
    modelsCache.set(cacheKey, { models, cachedAt: Date.now(), ttlMs: MODELS_FALLBACK_TTL_MS })
    return models
  }

  const metadata: RequestTelemetryMetadata = {
    area: 'models.list',
    origin: 'edge',
    method: 'GET',
    url: `${edgeBaseUrl}/api/models/list`
  }

  try {
    const response = await fetchWithTelemetry(metadata, {
      headers: { authorization: `Bearer ${token}`, ...getTelemetryHeaders() }
    })

    if (!response.ok) return fallback()

    const payload = await parseJsonWithTelemetry<unknown>(metadata, response)
    const parsed = modelsListResponseSchema.safeParse(payload)
    if (!parsed.success) {
      captureRequestIssue(metadata, {
        kind: 'schema_error',
        message: 'Models list response did not match schema',
        response
      })
      return fallback()
    }
    const models = parsed.data.models
    if (models.length === 0) {
      captureRequestIssue(metadata, {
        kind: 'schema_error',
        message: 'Models list response was empty',
        response
      })
      return fallback()
    }

    modelsCache.set(cacheKey, { models, cachedAt: Date.now(), ttlMs: MODELS_CACHE_TTL_MS })
    return models
  } catch {
    return fallback()
  }
}

export const useGitHubModels = (): ModelEntry[] => {
  const token = useAuthStore((state) => state.token)
  const { edgeBaseUrl } = useBrowserShellConfig()
  const [models, setModels] = useState<ModelEntry[]>([...SUPPORTED_MODELS])

  useEffect(() => {
    if (!token) {
      setModels([...SUPPORTED_MODELS])
      return
    }

    void fetchGitHubModels(edgeBaseUrl, token).then(setModels)
  }, [token, edgeBaseUrl])

  return models
}
