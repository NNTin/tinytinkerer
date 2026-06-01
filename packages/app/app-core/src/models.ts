export const SUPPORTED_MODELS = [
  { id: 'openai/gpt-5', label: 'GPT-5' }
] as const

export const DEFAULT_MODEL = SUPPORTED_MODELS[0].id

export const normalizeSelectedModel = (value: string | null | undefined): string =>
  value && value.trim() ? value : DEFAULT_MODEL
