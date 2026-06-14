export type Bindings = {
  GITHUB_CLIENT_ID?: string
  GITHUB_CLIENT_SECRET?: string
  TAVILY_API_KEY?: string
  ALLOWED_ORIGIN?: string
  ALLOWED_ORIGINS?: string
  /** Set to 'true' to allow all origins (dev only). When absent, no CORS header is sent. */
  ALLOW_ALL_ORIGINS?: string
  /** LiteLLM key with permission to create/update/read virtual keys. */
  LITELLM_KEY_MANAGEMENT_API_KEY?: string
  /** Secret used to derive stable per-GitHub-user LiteLLM virtual key values. */
  LITELLM_USER_KEY_SECRET?: string
  LITELLM_BASE_URL?: string
  LITELLM_ALLOWED_BASE_URLS?: string
  /** Optional comma-separated allowlist of GitHub numeric ids or logins. */
  GITHUB_ALLOWED_USERS?: string
  /** Per-user LiteLLM virtual-key budget in USD (default 1). */
  LITELLM_USER_MAX_BUDGET_USD?: string
  /** Per-user LiteLLM budget reset duration (default 30d). */
  LITELLM_USER_BUDGET_DURATION?: string
  /** Per-user LiteLLM request-per-minute limit (default 10). */
  LITELLM_USER_RPM_LIMIT?: string
  /** Per-user LiteLLM token-per-minute limit (default 100000). */
  LITELLM_USER_TPM_LIMIT?: string
  /** Comma-separated model aliases assigned to generated per-user keys. Empty means all configured models. */
  LITELLM_USER_MODELS?: string
  /** Anonymous (unauthenticated) user LiteLLM virtual-key budget in USD (default 0.10). */
  LITELLM_ANONYMOUS_MAX_BUDGET_USD?: string
  /** Anonymous user LiteLLM budget reset duration (default 30d). */
  LITELLM_ANONYMOUS_BUDGET_DURATION?: string
  /** Anonymous user LiteLLM request-per-minute limit (default 3). */
  LITELLM_ANONYMOUS_RPM_LIMIT?: string
  /** Anonymous user LiteLLM token-per-minute limit (default 20000). */
  LITELLM_ANONYMOUS_TPM_LIMIT?: string
  /**
   * Comma-separated hostnames the MCP proxy may connect to. Unset/empty keeps
   * the built-in private-address blocklist; when set, ONLY listed hosts pass
   * (see routes/mcp.ts).
   */
  MCP_ALLOWED_HOSTS?: string
  /** Inbound rate-limit window in seconds (default 60). See lib/inbound-rate-limit.ts. */
  RATE_LIMIT_WINDOW_SECONDS?: string
  /** Max OAuth code exchanges per caller per window (default 10; '0' disables). */
  RATE_LIMIT_AUTH_MAX?: string
  /** Max search requests per caller per window (default 30; '0' disables). */
  RATE_LIMIT_SEARCH_MAX?: string
  /** Max MCP discover/call requests per caller per window (default 60; '0' disables). */
  RATE_LIMIT_MCP_MAX?: string
  /** Sentry DSN for edge error reporting (secret; telemetry no-ops when absent). */
  SENTRY_DSN?: string
  /** Release identifier (build hash) for Sentry events. */
  SENTRY_RELEASE?: string
  /** Deployment environment label for Sentry (production, develop). */
  SENTRY_ENVIRONMENT?: string
}
