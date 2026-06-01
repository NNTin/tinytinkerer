import type { GitHubModelEntry } from '@tinytinkerer/contracts'

export const DEFAULT_MODEL = 'openai/gpt-5'

export const SUPPORTED_MODELS: GitHubModelEntry[] = [
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
