export const SUPPORTED_MODELS = [
  { id: 'openai/gpt-4.1-mini', label: 'GPT-4.1 mini' }
] as const

export const DEFAULT_MODEL = SUPPORTED_MODELS[0].id

export const normalizeSelectedModel = (value: string | null | undefined): string =>
  value && value.trim() ? value : DEFAULT_MODEL
