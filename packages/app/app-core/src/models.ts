import {
  DEFAULT_LITELLM_MODEL,
  type ModelEntry,
  type ModelProviderId
} from '@tinytinkerer/contracts'

export const DEFAULT_MODEL = DEFAULT_LITELLM_MODEL
export const DEFAULT_MODEL_PROVIDER: ModelProviderId = 'litellm'

// Sentinel for "use the deployment default": the client never knows the
// default LiteLLM base URL — it omits `litellmBaseUrl` from requests and the
// edge resolves its own configured URL (wrangler `LITELLM_BASE_URL`). An
// empty string keeps the settings value a plain string while making the
// distinction between "unset" and "explicitly chosen" recoverable.
export const LITELLM_DEPLOYMENT_DEFAULT = ''

// Labels use the raw model id — the same convention the edge applies to the
// fetched catalogue — so the picker doesn't mix friendly and raw names the
// moment a real fetch lands.
export const FALLBACK_MODELS: readonly ModelEntry[] = [
  {
    provider: DEFAULT_MODEL_PROVIDER,
    id: DEFAULT_MODEL,
    label: DEFAULT_MODEL,
    kind: 'chat'
  }
]

export const normalizeSelectedModel = (
  value: string | null | undefined
): string => (value && value.trim() ? value : DEFAULT_MODEL)

export type LiteLLMBaseUrlValidation =
  | { ok: true; url: string }
  | { ok: false; error: string }

/**
 * Validate a user-entered LiteLLM base URL with the same ACCEPT/REJECT rules
 * as the edge (`normalizeLiteLLMBaseUrl` in apps/edge/src/routes/models.ts):
 * https only, no credentials, query, or fragment. The client used to silently
 * strip those parts while the edge rejects them, so the two could disagree
 * about the same input — rejecting here keeps them aligned and gives Settings
 * a concrete error to show instead of silently replacing the value
 * (issue #179). An empty value means "use the deployment default": it is kept
 * as the {@link LITELLM_DEPLOYMENT_DEFAULT} sentinel so requests omit the
 * field and the edge resolves its own configured URL.
 *
 * Only the accept/reject decision is mirrored, not the canonical string: this
 * returns `url.href` (host-only URLs keep their trailing slash), while the
 * edge strips trailing slashes before building upstream URLs. That's fine —
 * the edge re-normalizes whatever string the client sends.
 */
export const validateLiteLLMBaseUrl = (
  value: string | null | undefined
): LiteLLMBaseUrlValidation => {
  const trimmed = value?.trim()
  if (!trimmed) return { ok: true, url: LITELLM_DEPLOYMENT_DEFAULT }
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return { ok: false, error: 'Enter a valid https:// URL.' }
  }
  if (url.protocol !== 'https:') {
    return { ok: false, error: 'The base URL must start with https://.' }
  }
  if (url.username || url.password || url.search || url.hash) {
    return {
      ok: false,
      error:
        'The base URL must not include credentials, a query string, or a fragment.'
    }
  }
  return { ok: true, url: url.href }
}

// Load-path normalization for stored preferences: an invalid stored value
// falls back to the deployment default rather than surfacing an error (the
// user already saw the validation message when they tried to save it).
export const normalizeLiteLLMBaseUrl = (
  value: string | null | undefined
): string => {
  const result = validateLiteLLMBaseUrl(value)
  return result.ok ? result.url : LITELLM_DEPLOYMENT_DEFAULT
}
