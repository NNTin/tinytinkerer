export type Bindings = {
  GITHUB_CLIENT_ID?: string
  GITHUB_CLIENT_SECRET?: string
  TAVILY_API_KEY?: string
  ALLOWED_ORIGIN?: string
  ALLOWED_ORIGINS?: string
  /** Set to 'true' to allow all origins (dev only). When absent, no CORS header is sent. */
  ALLOW_ALL_ORIGINS?: string
  GITHUB_MODELS_URL?: string
  GITHUB_MODELS_CATALOG_URL?: string
  OPENROUTER_BASE_URL?: string
  OPENROUTER_MODELS_URL?: string
  OPENROUTER_HTTP_REFERER?: string
  OPENROUTER_APP_TITLE?: string
  OPENROUTER_CATEGORIES?: string
  /** Sentry DSN for edge error reporting (secret; telemetry no-ops when absent). */
  SENTRY_DSN?: string
  /** Release identifier (build hash) for Sentry events. */
  SENTRY_RELEASE?: string
  /** Deployment environment label for Sentry (production, develop). */
  SENTRY_ENVIRONMENT?: string
}
