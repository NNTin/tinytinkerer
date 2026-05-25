import { useEffect, useState } from 'react'
import { SUPPORTED_MODELS } from '@tinytinkerer/app-core'
import { useAuthStore } from './app'
import { useBrowserShellConfig } from './hooks'

export type ModelEntry = { id: string; label: string }

const modelListResponseSchema = (raw: unknown): ModelEntry[] | null => {
  if (typeof raw !== 'object' || raw === null) return null
  const obj = raw as Record<string, unknown>
  if (!Array.isArray(obj['models'])) return null
  const result: ModelEntry[] = []
  for (const item of obj['models'] as unknown[]) {
    if (typeof item === 'object' && item !== null) {
      const entry = item as Record<string, unknown>
      if (typeof entry['id'] === 'string' && typeof entry['label'] === 'string') {
        result.push({ id: entry['id'], label: entry['label'] })
      }
    }
  }
  return result.length > 0 ? result : null
}

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
      headers: { authorization: `Bearer ${token}` }
    })

    if (!response.ok) return [...SUPPORTED_MODELS]

    const models = modelListResponseSchema(await response.json())
    if (!models) return [...SUPPORTED_MODELS]

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
