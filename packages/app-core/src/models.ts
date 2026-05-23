export const SUPPORTED_MODELS = [
  { id: 'openai/gpt-4.1-mini', label: 'GPT-4.1 mini' }
] as const

export const DEFAULT_MODEL = SUPPORTED_MODELS[0].id

export const isSupportedModel = (value: string): boolean =>
  SUPPORTED_MODELS.some((model) => model.id === value)

export const normalizeSelectedModel = (value: string | null | undefined): string =>
  value && isSupportedModel(value) ? value : DEFAULT_MODEL
