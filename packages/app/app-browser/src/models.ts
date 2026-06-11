import { useCallback, useMemo, useState } from 'react'
import { DEFAULT_LITELLM_BASE_URL, FALLBACK_MODELS } from '@tinytinkerer/app-core'
import {
  EDGE_ROUTE_PATHS,
  modelsListResponseSchema,
  type ModelEntry
} from '@tinytinkerer/contracts'
import { useAuthStore, useSettingsStore } from './app'
import { useBrowserShellConfig } from './hooks'
import { getTelemetryHeaders } from './telemetry/telemetry'
import {
  captureRequestIssue,
  fetchWithTelemetry,
  parseJsonWithTelemetry,
  type RequestTelemetryMetadata
} from './telemetry/request-telemetry'

export type { ModelEntry }
export type ModelsState = {
  models: ModelEntry[]
  isRefreshing: boolean
  refreshError: string | null
  refreshModels: () => Promise<ModelEntry[]>
}

export type FetchModelsResult = {
  models: ModelEntry[]
  /**
   * True when the list is the fallback (last-known or built-in) catalogue
   * rather than a fresh fetch, so a user-triggered refresh can say "couldn't
   * refresh" instead of silently spinning and stopping (issue #179).
   */
  fromFallback: boolean
}

type CacheEntry = {
  models: ModelEntry[]
  cachedAt: number
  ttlMs: number
  fromFallback: boolean
}
const modelsCache = new Map<string, CacheEntry>()
const MODELS_CACHE_TTL_MS = 5 * 60_000
// Brief negative cache: when a list fetch fails (e.g. the edge is rate limited),
// don't re-probe — and re-report the failure — on every component remount. The
// edge already serves a cached catalogue, so a short window here is enough to
// stop the frontend hammering it during a rate-limit storm (TINYTINKERER-FRONTEND-5).
const MODELS_FALLBACK_TTL_MS = 30_000
const fallbackModels = (): ModelEntry[] => [...FALLBACK_MODELS]

/** Reset the in-memory models cache. Test-only — the cache is module-level. */
export const clearModelsCache = (): void => modelsCache.clear()

const hashToken = async (token: string): Promise<string> => {
  const data = new TextEncoder().encode(token)
  const hash = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export const fetchModels = async (
  edgeBaseUrl: string,
  token: string,
  // An explicit user-triggered refresh (the Settings → Models refresh button)
  // must re-probe the edge, so it sets `force` to skip the fresh-cache read
  // below. Without this, the button is a silent no-op: it is the ONLY caller of
  // this function, so the first click populates the cache and every subsequent
  // click within the TTL (5 min on success, 30s on a fallback) returns the same
  // cached list without a network request. The negative-cache WRITE in
  // `fallback()` still runs on a forced fetch, so background remounts / future
  // callers stay protected from a rate-limit storm (TINYTINKERER-FRONTEND-5);
  // only this deliberate user action bypasses the read.
  {
    force = false,
    litellmBaseUrl = DEFAULT_LITELLM_BASE_URL
  }: { force?: boolean; litellmBaseUrl?: string } = {}
): Promise<FetchModelsResult> => {
  const tokenHash = await hashToken(token)
  const cacheKey = `${edgeBaseUrl}:litellm:${litellmBaseUrl}:${tokenHash}`
  const cached = modelsCache.get(cacheKey)
  if (!force && cached && Date.now() - cached.cachedAt <= cached.ttlMs)
    return { models: cached.models, fromFallback: cached.fromFallback }

  // The model catalogue is cacheable, so when the edge is in a cooldown / cache-
  // miss state (429 or 503) we degrade gracefully: serve the LAST-KNOWN list —
  // the most recent list we successfully fetched (even if its freshness TTL has
  // lapsed) — and only fall back to the built-in defaults when we've never seen a
  // real list. Cache the served value briefly so rapid remounts during a cooldown
  // don't re-fetch (and re-report) every time. This mirrors the edge, which
  // serves its own last-known catalogue (TINYTINKERER-FRONTEND-C / FRONTEND-D,
  // TINYTINKERER-FRONTEND-5).
  const fallback = (): FetchModelsResult => {
    const models = cached?.models ?? fallbackModels()
    modelsCache.set(cacheKey, {
      models,
      cachedAt: Date.now(),
      ttlMs: MODELS_FALLBACK_TTL_MS,
      fromFallback: true
    })
    return { models, fromFallback: true }
  }

  const params = new URLSearchParams({ provider: 'litellm', litellmBaseUrl })
  const url = `${edgeBaseUrl}${EDGE_ROUTE_PATHS.modelsList}?${params.toString()}`
  const metadata: RequestTelemetryMetadata = {
    area: 'models.list',
    origin: 'edge',
    method: 'GET',
    url,
    // The edge deliberately emits a 429 (residual window-opener) or a 503 + Retry-
    // After (its designed cooldown / cache-miss signal) for this CACHEABLE
    // catalogue while the upstream provider is rate limited. Both mean "serve your cached
    // list and retry later", which `fallback()` does — they are not server-down
    // bugs and add no signal. A transient client-side `network_error` (Failed to
    // fetch — host briefly unreachable / connection blip) on this background edge
    // fetch is the same graceful-degradation path: `fallback()` serves the
    // last-known list, exactly like our sibling background fetches already accept
    // (shell.ts health poll → FRONTEND-8, github-user.ts → FRONTEND-7). Accept ONLY
    // these two statuses and this one kind for ONLY models.list; any other status,
    // and parse/schema failures, still report.
    accept: {
      status: [429, 503],
      kinds: ['network_error'],
      reason:
        'edge cooldown/cache-miss (429/503) for cacheable model catalogue, plus transient client-side network failure on this background edge fetch; frontend serves last-known list either way (FRONTEND-C, FRONTEND-D, FRONTEND-F)'
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
      ttlMs: MODELS_CACHE_TTL_MS,
      fromFallback: false
    })
    return { models, fromFallback: false }
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

export const useModels = (selectedModel?: string): ModelsState => {
  const token = useAuthStore((state) => state.token)
  const litellmBaseUrl = useSettingsStore((state) => state.litellmBaseUrl)
  const { edgeBaseUrl } = useBrowserShellConfig()
  const [models, setModels] = useState<ModelEntry[]>(fallbackModels())
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState<string | null>(null)

  const refreshModels = useCallback(async (): Promise<ModelEntry[]> => {
    if (!token) {
      const nextModels = fallbackModels()
      setModels(nextModels)
      setRefreshError('Sign in with GitHub to refresh models.')
      return includeSelectedModel(nextModels, selectedModel)
    }

    setIsRefreshing(true)
    setRefreshError(null)
    try {
      // Force a real re-probe: this is a deliberate user action, so honour it
      // instead of returning the module-level cache from a previous click.
      const result = await fetchModels(edgeBaseUrl, token, {
        force: true,
        litellmBaseUrl
      })
      setModels(result.models)
      // Every failure inside fetchModels degrades to the fallback list, so
      // without this the refresh button spins and stops with no feedback when
      // the edge is down (issue #179). Soft message: the list shown is usable.
      if (result.fromFallback) {
        setRefreshError(
          "Couldn't refresh models — showing the last-known list."
        )
      }
      return includeSelectedModel(result.models, selectedModel)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to refresh models.'
      setRefreshError(message)
      return includeSelectedModel(models, selectedModel)
    } finally {
      setIsRefreshing(false)
    }
  }, [edgeBaseUrl, litellmBaseUrl, models, selectedModel, token])

  const visibleModels = useMemo(
    () => includeSelectedModel(models, selectedModel),
    [models, selectedModel]
  )

  return {
    models: visibleModels,
    isRefreshing,
    refreshError,
    refreshModels
  }
}
