import type { GitHubModelEntry, ModelProviderId } from '@tinytinkerer/contracts'

export const DEFAULT_MODEL = 'openai/gpt-5'
export const DEFAULT_MODEL_PROVIDER: ModelProviderId = 'litellm'
export const DEFAULT_LITELLM_BASE_URL = 'https://litellm.labs.lair.nntin.xyz/'

export const FALLBACK_MODELS: readonly GitHubModelEntry[] = [
  {
    provider: DEFAULT_MODEL_PROVIDER,
    id: DEFAULT_MODEL,
    label: 'OpenAI GPT-5',
    kind: 'chat'
  }
]

export const normalizeSelectedModel = (
  value: string | null | undefined
): string => (value && value.trim() ? value : DEFAULT_MODEL)

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
