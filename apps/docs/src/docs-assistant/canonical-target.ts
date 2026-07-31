/**
 * What "the same documentation page" means, for every comparison this module
 * makes (issue #478).
 *
 * Citations are checked against normalized canonical identity rather than raw
 * strings, because the assistant, the corpus, and the reader's own address bar
 * spell the same page several ways: `/docs/x`, `/docs/x/`, and
 * `https://tinytinkerer.dev/docs/x` are one target, and a string comparison
 * would let a fabricated link hide behind a trailing slash.
 *
 * Trailing-slash policy goes through `canonicalizeDocusaurusPermalink` — the
 * same helper #474 built the corpus permalinks with — so a citation and the
 * permalink it cites cannot drift apart under a config change.
 */
import { canonicalizeDocusaurusPermalink } from '../docs-corpus/docusaurus-compatibility'
import type { SiteUrlConfig } from '../docs-corpus/manifest-store'

/**
 * A documentation page, plus at most one section within it.
 *
 * `document` is the canonical pathname; `anchor` carries no leading `#` and is
 * `null` for a whole-page target. The two are kept apart rather than joined
 * into one string because they are compared at different strengths: an
 * obligation is satisfied by the *document*, while a rendered link is
 * authorized by the exact *target*.
 */
export type CanonicalDocumentationTarget = {
  document: string
  anchor: string | null
}

/** Where the documentation lives, and which origin counts as "this site". */
export type DocumentationSite = {
  siteConfig: SiteUrlConfig
  /**
   * The site's own origin, so `https://host/docs/x` and `/docs/x` resolve to
   * one target. `null` when the origin is unknown (server rendering, a test),
   * which makes every absolute URL external and therefore outside the policy —
   * the conservative direction: it never demotes a link it cannot judge.
   */
  origin: string | null
}

export type DocumentationLinkClassification =
  | { kind: 'outside-policy' }
  /**
   * The URL names no destination this policy can judge — an empty or malformed
   * one, including what `content-markdown` leaves behind after stripping a URL
   * it refuses to navigate to. Demoted rather than allowed: it cannot be
   * authorized, and it cannot be shown to be somebody else's page either.
   */
  | { kind: 'unresolvable' }
  | {
      kind: 'documentation'
      target: CanonicalDocumentationTarget
      /**
       * The link carried a query string. No tool result ever produces one, so
       * such a link can never be authorized — but it is still a documentation
       * link, so it is still governed.
       */
      hasQuery: boolean
    }

// Resolution base for a relative link. Deliberately the documentation base URL
// rather than the reader's current route: resolving against the route would make
// the identical answer legal on one page and demoted on another, and the model
// has no stable notion of "here" to author against anyway.
const RESOLUTION_ORIGIN = 'https://documentation.invalid'

const decodeAnchor = (value: string): string => {
  try {
    return decodeURIComponent(value)
  } catch {
    // A malformed percent-escape is not a valid anchor either way; comparing it
    // raw simply means it matches nothing.
    return value
  }
}

/**
 * Decides whether a URL is a documentation link at all, and if so which target
 * it names.
 *
 * `outside-policy` covers everything this issue deliberately does not govern:
 * other origins, `mailto:`/`tel:`, and same-site paths outside the documentation
 * base.
 *
 * `unresolvable` is the third answer, and it exists because the renderer strips
 * a URL it will not navigate to (`content-markdown`'s `sanitizeLinkUrl` empties
 * a protocol-relative or non-web scheme) *before* this policy ever sees the
 * parsed document. Such a link is not proof of anything: it may be the sanitized
 * remains of `//host/docs/invented/`, which is a same-origin documentation
 * fabrication. Treating it as outside-policy would leave a clickable `<a href="">`
 * behind, so it is reported as its own outcome and demoted.
 */
export const classifyDocumentationLink = (
  url: string,
  site: DocumentationSite
): DocumentationLinkClassification => {
  const trimmed = url.trim()
  if (trimmed.length === 0) {
    return { kind: 'unresolvable' }
  }

  const scheme = /^([a-z][a-z\d+\-.]*):/i.exec(trimmed)?.[1]?.toLowerCase()
  if (scheme && scheme !== 'http' && scheme !== 'https') {
    return { kind: 'outside-policy' }
  }

  // A protocol-relative URL borrows the *page's* scheme, so `//host/docs/x` is
  // this site whenever `host` is. Treating it as always-foreign was a real
  // bypass: the finalizer left it alone, and the renderer then emptied its href
  // rather than navigating anywhere.
  const protocolRelative = !scheme && trimmed.startsWith('//')
  const absolute = Boolean(scheme) || protocolRelative

  const base = new URL(site.siteConfig.baseUrl, RESOLUTION_ORIGIN)
  let parsed: URL
  try {
    parsed = new URL(
      protocolRelative
        ? `${new URL(site.origin ?? RESOLUTION_ORIGIN).protocol}${trimmed}`
        : trimmed,
      base
    )
  } catch {
    return { kind: 'unresolvable' }
  }

  if (absolute) {
    // An absolute URL is only this site's when we know the site's origin and it
    // matches. Everything else is somebody else's page.
    if (site.origin === null || parsed.origin !== new URL(site.origin).origin) {
      return { kind: 'outside-policy' }
    }
  }

  const canonicalBase = stripTrailingSlash(
    canonicalizeDocusaurusPermalink(base.pathname, site.siteConfig)
  )
  const canonicalPath = canonicalizeDocusaurusPermalink(parsed.pathname, site.siteConfig)
  // A path *segment* boundary, not a string prefix: bare `startsWith` classified
  // `/docs-evil/...` as documentation because it shares the first five
  // characters of `/docs/`. The base itself still counts, so `/docs/` resolves.
  if (canonicalPath !== canonicalBase && !canonicalPath.startsWith(`${canonicalBase}/`)) {
    return { kind: 'outside-policy' }
  }

  const anchor = parsed.hash.startsWith('#') ? decodeAnchor(parsed.hash.slice(1)) : ''
  return {
    kind: 'documentation',
    target: { document: canonicalPath, anchor: anchor.length > 0 ? anchor : null },
    hasQuery: parsed.search.length > 0
  }
}

// `/docs/` and `/docs` must both prefix-match `/docs/architecture/…`; comparing
// against the slash-stripped base is what makes the check independent of the
// site's trailing-slash setting.
const stripTrailingSlash = (value: string): string =>
  value.length > 1 && value.endsWith('/') ? value.slice(0, -1) : value

/**
 * The canonical identity of a permalink a tool result returned. Used for both
 * ledger keys and the targets generated citations point at, so an authored
 * permalink and a model-written link to the same page normalize identically.
 */
export const canonicalizeResultPermalink = (
  permalink: string,
  anchor: string | null,
  site: DocumentationSite
): CanonicalDocumentationTarget => ({
  document: canonicalizeDocusaurusPermalink(
    toPathname(permalink, site.siteConfig),
    site.siteConfig
  ),
  anchor: anchor && anchor.length > 0 ? anchor : null
})

const toPathname = (value: string, siteConfig: SiteUrlConfig): string => {
  try {
    return new URL(value, new URL(siteConfig.baseUrl, RESOLUTION_ORIGIN)).pathname
  } catch {
    return value
  }
}

/** `/docs/x` + `intro` → `/docs/x#intro`. The link a citation actually renders. */
export const targetToHref = (target: CanonicalDocumentationTarget): string =>
  target.anchor === null ? target.document : `${target.document}#${target.anchor}`

/** Same page, ignoring the section — the strength an obligation is settled at. */
export const sameDocument = (
  a: CanonicalDocumentationTarget,
  b: CanonicalDocumentationTarget
): boolean => a.document === b.document

/**
 * Exact target, section included — the strength a rendered link is authorized at.
 *
 * The separator is the ESCAPED `\u0000`, never a literal NUL: `check-text-files`
 * rejects a NUL byte in tracked source, and the same escape is what
 * `docs-corpus/manifest-store.ts` and `docs-search/corpus-ref-map.ts` already
 * key their caches with. A character that cannot appear in a pathname or an
 * anchor is the point: it keeps `(/docs/a, b)` and `(/docs/a#b, null)` from
 * colliding on one key.
 */
export const targetKey = (target: CanonicalDocumentationTarget): string =>
  `${target.document}\u0000${target.anchor ?? ''}`
