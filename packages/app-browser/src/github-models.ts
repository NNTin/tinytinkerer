import { useEffect, useState } from 'react'
import { SUPPORTED_MODELS } from '@tinytinkerer/app-core'
import { modelsListResponseSchema, type GitHubModelEntry } from '@tinytinkerer/contracts'
import { useAuthStore } from './app'
import { useBrowserShellConfig } from './hooks'
import { getTelemetryHeaders } from './telemetry/telemetry'

export type ModelEntry = GitHubModelEntry

type CacheEntry = { models: ModelEntry[]; cachedAt: number }
const modelsCache = new Map<string, CacheEntry>()
const MODELS_CACHE_TTL_MS = 5 * 60_000

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
  if (cached && Date.now() - cached.cachedAt <= MODELS_CACHE_TTL_MS) return cached.models

  try {
    const response = await fetch(`${edgeBaseUrl}/api/models/list`, {
      headers: { authorization: `Bearer ${token}`, ...getTelemetryHeaders() }
    })

    if (!response.ok) return [...SUPPORTED_MODELS]

    const parsed = modelsListResponseSchema.safeParse(await response.json())
    if (!parsed.success) return [...SUPPORTED_MODELS]
    const models = parsed.data.models
    if (models.length === 0) return [...SUPPORTED_MODELS]

    modelsCache.set(cacheKey, { models, cachedAt: Date.now() })
    return models
  } catch {
    return [...SUPPORTED_MODELS]
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
