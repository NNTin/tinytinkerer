// Every browser shell routes '/auth/callback' through a `createHashRouter`
// (GitHub Pages compatibility — see apps/shell/src/app/router.tsx,
// apps/canvas/src/app/router.tsx, and apps/host/src/router.tsx), so the redirect
// URI GitHub is sent is of the form `…/#/auth/callback`. GitHub appends its
// response as a query string on the URL it redirects to, but with a hash router
// that means the `code`/`state` pair can land in EITHER `window.location.search`
// (a plain, non-hash redirect_uri) OR after the `?` inside `window.location.hash`
// (a hash-mode redirect_uri, which is what every shell here actually registers).
// Reading only `window.location.search` — the shared callback controller's
// original behavior — silently drops the parameters in the hash-router case.

export type OAuthCallbackParams = {
  code: string | null
  state: string | null
}

// Parses the query-string portion of a hash fragment, e.g. '#/auth/callback?code=x&state=y'.
// Returns null params when the fragment carries no '?' (no response was appended).
const parseHashQuery = (hash: string): OAuthCallbackParams => {
  const withoutLeadingHash = hash.replace(/^#/, '')
  const queryStart = withoutLeadingHash.indexOf('?')
  if (queryStart === -1) {
    return { code: null, state: null }
  }

  const hashParams = new URLSearchParams(withoutLeadingHash.slice(queryStart + 1))
  return { code: hashParams.get('code'), state: hashParams.get('state') }
}

/**
 * Reads the GitHub OAuth `code`/`state` pair off the current URL, checking
 * `window.location.search` first and falling back to the hash fragment's query
 * part. Search wins when both happen to carry a code (it is the standard place
 * to look; the hash fallback exists only for the hash-router redirect case).
 */
export const readOAuthCallbackParams = (): OAuthCallbackParams => {
  const searchParams = new URLSearchParams(window.location.search)
  if (searchParams.get('code')) {
    return { code: searchParams.get('code'), state: searchParams.get('state') }
  }

  return parseHashQuery(window.location.hash)
}

/** True when the current URL carries a GitHub OAuth `code`, in either location. */
export const urlHasOAuthCode = (): boolean => readOAuthCallbackParams().code !== null
