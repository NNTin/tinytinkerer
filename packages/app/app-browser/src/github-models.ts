import { useCallback, useEffect, useMemo, useState } from 'react'
import { SUPPORTED_MODELS } from '@tinytinkerer/app-core'
import {
  EDGE_ROUTE_PATHS,
  modelsListResponseSchema,
  type GitHubModelEntry
} from '@tinytinkerer/contracts'
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
export type GitHubModelsState = {
  models: ModelEntry[]
  isRefreshing: boolean
  refreshError: string | null
  refreshGitHubModels: () => Promise<ModelEntry[]>
}

type CacheEntry = { models: ModelEntry[]; cachedAt: number; ttlMs: number }
const modelsCache = new Map<string, CacheEntry>()
const MODELS_CACHE_TTL_MS = 5 * 60_000
// Brief negative cache: when a list fetch fails (e.g. the edge is rate limited),
// don't re-probe — and re-report the failure — on every component remount. The
// edge already serves a cached catalogue, so a short window here is enough to
// stop the frontend hammering it during a rate-limit storm (TINYTINKERER-FRONTEND-5).
const MODELS_FALLBACK_TTL_MS = 30_000
const STATIC_MODELS = [...SUPPORTED_MODELS]

const loadStaticCatalog = async (): Promise<ModelEntry[]> => {
  const { loadSupportedChatModels } = await import('@tinytinkerer/app-core')
  return loadSupportedChatModels()
}

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
  if (cached && Date.now() - cached.cachedAt <= cached.ttlMs)
    return cached.models

  // The model catalogue is cacheable, so when the edge is in a cooldown / cache-
  // miss state (429 or 503) we degrade gracefully: serve the LAST-KNOWN list —
  // the most recent list we successfully fetched (even if its freshness TTL has
  // lapsed) — and only fall back to the built-in defaults when we've never seen a
  // real list. Cache the served value briefly so rapid remounts during a cooldown
  // don't re-fetch (and re-report) every time. This mirrors the edge, which
  // serves its own last-known catalogue (TINYTINKERER-FRONTEND-C / FRONTEND-D,
  // TINYTINKERER-FRONTEND-5).
  const fallback = (): ModelEntry[] => {
    const models = cached?.models ?? [...STATIC_MODELS]
    modelsCache.set(cacheKey, {
      models,
      cachedAt: Date.now(),
      ttlMs: MODELS_FALLBACK_TTL_MS
    })
    return models
  }

  const metadata: RequestTelemetryMetadata = {
    area: 'models.list',
    origin: 'edge',
    method: 'GET',
    url: `${edgeBaseUrl}${EDGE_ROUTE_PATHS.modelsList}`,
    // The edge deliberately emits a 429 (residual window-opener) or a 503 + Retry-
    // After (its designed cooldown / cache-miss signal) for this CACHEABLE
    // catalogue while GitHub Models is rate limited. Both mean "serve your cached
    // list and retry later", which `fallback()` does — they are not server-down
    // bugs and add no signal. Accept ONLY these two statuses for ONLY models.list;
    // any other status (and network/parse/schema failures) still reports.
    accept: {
      status: [429, 503],
      reason:
        'edge cooldown/cache-miss for cacheable model catalogue; frontend serves last-known list (FRONTEND-C, FRONTEND-D)'
    }
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

    modelsCache.set(cacheKey, {
      models,
      cachedAt: Date.now(),
      ttlMs: MODELS_CACHE_TTL_MS
    })
    return models
  } catch {
    return fallback()
  }
}

const includeSelectedModel = (
  models: ModelEntry[],
  selectedModel: string | null | undefined
): ModelEntry[] => {
  const normalized = selectedModel?.trim()
  if (!normalized || models.some((model) => model.id === normalized))
    return models
  return [{ id: normalized, label: normalized, kind: 'chat' }, ...models]
}

export const useGitHubModels = (selectedModel?: string): GitHubModelsState => {
  const token = useAuthStore((state) => state.token)
  const { edgeBaseUrl } = useBrowserShellConfig()
  const [models, setModels] = useState<ModelEntry[]>(STATIC_MODELS)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    loadStaticCatalog()
      .then((catalogModels) => {
        if (!cancelled && catalogModels.length > 0) {
          setModels(catalogModels)
        }
      })
      // The dynamic import can fail (bundler/JSON loading issue). Keep the
      // built-in STATIC_MODELS defaults rather than throwing an unhandled
      // rejection — a real refresh still surfaces errors via refreshError.
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const refreshGitHubModels = useCallback(async (): Promise<ModelEntry[]> => {
    if (!token) {
      const nextModels = [...STATIC_MODELS]
      setModels(nextModels)
      setRefreshError('Sign in with GitHub to refresh models.')
      return includeSelectedModel(nextModels, selectedModel)
    }

    setIsRefreshing(true)
    setRefreshError(null)
    try {
      const nextModels = await fetchGitHubModels(edgeBaseUrl, token)
      setModels(nextModels)
      return includeSelectedModel(nextModels, selectedModel)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to refresh models.'
      setRefreshError(message)
      return includeSelectedModel(models, selectedModel)
    } finally {
      setIsRefreshing(false)
    }
  }, [edgeBaseUrl, models, selectedModel, token])

  const visibleModels = useMemo(
    () => includeSelectedModel(models, selectedModel),
    [models, selectedModel]
  )

  return {
    models: visibleModels,
    isRefreshing,
    refreshError,
    refreshGitHubModels
  }
}
