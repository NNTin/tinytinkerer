export type Bindings = {
  GITHUB_CLIENT_ID?: string
  GITHUB_CLIENT_SECRET?: string
  TAVILY_API_KEY?: string
  ALLOWED_ORIGIN?: string
  ALLOWED_ORIGINS?: string
  /** Set to 'true' to allow all origins (dev only). When absent, no CORS header is sent. */
  ALLOW_ALL_ORIGINS?: string
  LITELLM_API_KEY?: string
  LITELLM_BASE_URL?: string
  LITELLM_ALLOWED_BASE_URLS?: string
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
