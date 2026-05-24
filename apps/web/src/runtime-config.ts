export const resolveGitHubRedirectUri = (
  configuredRedirectUri: string | undefined,
  baseUrl: string,
  origin: string
): string => configuredRedirectUri ?? `${origin}${baseUrl}#/auth/callback`
