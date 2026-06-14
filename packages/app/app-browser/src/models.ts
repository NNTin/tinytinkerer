import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuthStore, useSettingsStore } from './app'
import { useBrowserShellConfig } from './hooks'
import {
  clearModelsCache,
  fallbackModels,
  fetchModels,
  includeSelectedModel,
  type FetchModelsResult,
  type ModelEntry
} from './models-cache'

// Public surface stays here: the transport/caching policy now lives in
// models-cache.ts (testable without React), and this file is the UI-state hook
// that consumes it. Re-export the transport symbols so importers and tests keep
// a single, stable `./models` entry point.
export { clearModelsCache, fetchModels }
export type { FetchModelsResult, ModelEntry }

export type ModelsState = {
  models: ModelEntry[]
  isRefreshing: boolean
  refreshError: string | null
  refreshModels: () => Promise<ModelEntry[]>
}

export const useModels = (selectedModel?: string): ModelsState => {
  const token = useAuthStore((state) => state.token)
  const litellmBaseUrl = useSettingsStore((state) => state.litellmBaseUrl)
  const { edgeBaseUrl } = useBrowserShellConfig()
  const [models, setModels] = useState<ModelEntry[]>(fallbackModels())
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState<string | null>(null)

  // Reset to the built-in fallback when the deployment changes: the previous
  // base URL's catalogue (and any stale refreshError) must not linger against a
  // different LiteLLM deployment until the user manually refreshes (LOW-4). The
  // module cache is keyed by base URL, so a later refresh still picks up that
  // deployment's own list.
  useEffect(() => {
    setModels(fallbackModels())
    setRefreshError(null)
  }, [litellmBaseUrl])

  const refreshModels = useCallback(async (): Promise<ModelEntry[]> => {
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
