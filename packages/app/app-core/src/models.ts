import type { GitHubModelEntry, ModelProviderId } from '@tinytinkerer/contracts'

export const DEFAULT_MODEL = 'openai/gpt-5'
export const DEFAULT_MODEL_PROVIDER: ModelProviderId = 'github'
export const DEFAULT_LITELLM_BASE_URL = 'https://litellm.labs.lair.nntin.xyz/'
export const DEFAULT_MODELS_BY_PROVIDER: Record<ModelProviderId, string> = {
  github: DEFAULT_MODEL,
  openrouter: 'openai/gpt-4.1-mini',
  litellm: DEFAULT_MODEL
}

export const SUPPORTED_MODELS: readonly GitHubModelEntry[] = [
  { id: DEFAULT_MODEL, label: 'OpenAI GPT-5', kind: 'chat' }
]

export const loadGitHubModelsCatalog = async (): Promise<
  GitHubModelEntry[]
> => {
  const { default: catalog } = await import('./github-models-catalog.json')
  return catalog as GitHubModelEntry[]
}

export const loadSupportedChatModels = async (): Promise<GitHubModelEntry[]> =>
  (await loadGitHubModelsCatalog()).filter((model) => model.kind === 'chat')

export const loadSupportedEmbeddingModels = async (): Promise<
  GitHubModelEntry[]
> =>
  (await loadGitHubModelsCatalog()).filter(
    (model) => model.kind === 'embedding'
  )

export const normalizeSelectedModel = (
  value: string | null | undefined
): string => (value && value.trim() ? value : DEFAULT_MODEL)

export const normalizeModelProvider = (
  value: string | null | undefined
): ModelProviderId =>
  value === 'openrouter' || value === 'github' || value === 'litellm'
    ? value
    : DEFAULT_MODEL_PROVIDER

export const normalizeSelectedModelForProvider = (
  provider: ModelProviderId,
  value: string | null | undefined
): string => (value && value.trim() ? value : DEFAULT_MODELS_BY_PROVIDER[provider])

export const normalizeLiteLLMBaseUrl = (
  value: string | null | undefined
): string => {
  const trimmed = value?.trim()
  if (!trimmed) return DEFAULT_LITELLM_BASE_URL
  try {
    const url = new URL(trimmed)
    if (url.protocol !== 'https:') return DEFAULT_LITELLM_BASE_URL
    url.username = ''
    url.password = ''
    url.search = ''
    url.hash = ''
    return url.href
  } catch {
    return DEFAULT_LITELLM_BASE_URL
  }
}
