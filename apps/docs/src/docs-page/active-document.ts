/**
 * Route → authored-document resolution for the documentation assistant (#476).
 *
 * This is the pure half of the docs page context: it takes what Docusaurus'
 * active-doc context reports for the current route, plus the #474 corpus
 * manifest store, and answers one question — *which authored document, if any,
 * is the current page?*
 *
 * "Current page" is deliberately narrow. It means an authored Docusaurus
 * documentation document that exists in the #474 corpus. The docs landing
 * route, `/search`, category index pages, and 404s are all legitimate places
 * for the assistant to be mounted, and all of them are explicitly *not* a
 * current document rather than a silent `undefined`.
 *
 * Nothing here reads the DOM, headings, prose, or rendered metadata: identity
 * comes from Docusaurus routing data, and everything a caller is allowed to see
 * (title, canonical permalink, `unlisted`) comes from the corpus manifest the
 * build produced from authored Markdown.
 */
import type { DocumentationCorpusStore, SiteUrlConfig } from '../docs-corpus/manifest-store'
import { canonicalizeDocusaurusPermalink } from '../docs-corpus/docusaurus-compatibility'

/**
 * The validated identity of the authored document a route resolves to. Every
 * field is the corpus manifest's, not the router's: a consumer that cites this
 * permalink is citing the same canonical URL #475 search results carry, and the
 * same `ref` #477's `read_doc` accepts.
 */
export type DocsActiveDocument = {
  /** Docusaurus document id — the #474 corpus `ref`. */
  ref: string
  /** Docusaurus version name this route belongs to. */
  version: string
  /** Whether `version` is the canonical (`isLast`) documentation version. */
  isLast: boolean
  title: string
  /** Canonical, base-url-aware permalink, from the corpus manifest. */
  permalink: string
  /**
   * Authored `unlisted: true`. Such a document is a perfectly valid current
   * page on a direct visit even though global search must never surface it.
   */
  unlisted: boolean
}

/**
 * Why a route has no current document. These are separate codes rather than one
 * "no document" flag because consumers act on them differently: only
 * `corpus_pending` and a retryable `corpus_unavailable` are worth trying again,
 * and only `unknown_active_document` indicates something is actually wrong.
 */
export type DocsNoActiveDocumentReason =
  /** Docusaurus reports no active doc here (search, 404, non-docs routes). */
  | 'not_a_document_route'
  /** A Docusaurus-generated category index page; nobody authored it. */
  | 'generated_index_route'
  /** The corpus manifest has not finished loading yet (or this is SSR). */
  | 'corpus_pending'
  /** The corpus manifest could not be loaded or validated. */
  | 'corpus_unavailable'
  /** An authored-looking active id that the corpus manifest does not contain. */
  | 'unknown_active_document'

export type DocsActiveDocumentState =
  | { status: 'document'; document: DocsActiveDocument }
  | {
      status: 'no-document'
      reason: DocsNoActiveDocumentReason
      message: string
      retryable: boolean
    }

/**
 * A route/manifest mapping anomaly. Diagnostics never change what is resolved —
 * they exist so a corpus that has drifted from the built routes is loud instead
 * of quietly degrading into "this page has no document".
 */
export type DocsPageDiagnosticCode = 'unknown_active_document' | 'permalink_mismatch'

export type DocsPageDiagnostic = {
  code: DocsPageDiagnosticCode
  message: string
  pathname: string
  ref: string
}

/**
 * The value the docs page context publishes. `pathname` and `active` are always
 * derived from the same render, so a consumer can never observe the previous
 * document paired with the new pathname during an SPA navigation.
 */
export type DocsPageContextValue = {
  /** Current router pathname, base URL included, exactly as routed. */
  pathname: string
  active: DocsActiveDocumentState
  diagnostic?: DocsPageDiagnostic
}

/**
 * What Docusaurus' active-doc context reports for the current route, reduced to
 * the primitives this module needs. Keeping it primitive (rather than passing
 * `ActiveDocContext` through) is what lets the provider memoize on stable
 * values instead of the fresh object that hook returns every render.
 */
export type DocsActiveRoute = {
  pathname: string
  /** `useActiveDocContext(...).activeDoc?.id`. */
  activeDocId?: string
  /** `useActiveDocContext(...).activeVersion?.name`. */
  activeVersionName?: string
}

/** The #474 corpus store as seen by the provider, including its not-yet states. */
export type DocsCorpusLookup =
  | { status: 'pending' }
  | { status: 'unavailable'; message: string; retryable: boolean }
  | { status: 'ready'; store: Pick<DocumentationCorpusStore, 'findByRef'> }

const noDocument = (
  pathname: string,
  reason: DocsNoActiveDocumentReason,
  message: string,
  retryable: boolean,
  diagnostic?: DocsPageDiagnostic
): DocsPageContextValue => ({
  pathname,
  active: { status: 'no-document', reason, message, retryable },
  ...(diagnostic ? { diagnostic } : {})
})

/**
 * Docusaurus puts generated category index pages in the very same
 * `version.docs` list as authored documents. Its own `GlobalDoc` type documents
 * how to tell them apart: a generated index carries its *slug* as its id, and
 * "slugs have leading slashes but IDs don't, [so] there won't be clashes".
 *
 * This matters because such a page is legitimately absent from the corpus —
 * nobody authored it. Without this check every category index would look like
 * corpus drift and raise a diagnostic on a perfectly healthy site.
 */
const isGeneratedIndexId = (activeDocId: string): boolean => activeDocId.startsWith('/')

/**
 * Resolves the current route to an authored document, or to an explicit reason
 * why it has none.
 *
 * The order of the checks is the contract: whether a route is a document route
 * at all is decided by Docusaurus routing alone, so `/search` and 404s get a
 * final answer immediately instead of being reported as "still loading" until
 * the manifest arrives.
 */
export const resolveDocsPageContext = (
  route: DocsActiveRoute,
  corpus: DocsCorpusLookup,
  siteConfig: SiteUrlConfig
): DocsPageContextValue => {
  const { pathname, activeDocId, activeVersionName } = route

  if (activeDocId === undefined) {
    return noDocument(
      pathname,
      'not_a_document_route',
      `"${pathname}" is not a Docusaurus document route`,
      false
    )
  }
  if (isGeneratedIndexId(activeDocId)) {
    return noDocument(
      pathname,
      'generated_index_route',
      `"${pathname}" is a Docusaurus-generated category index, not an authored document`,
      false
    )
  }
  if (corpus.status === 'pending') {
    return noDocument(
      pathname,
      'corpus_pending',
      'the documentation corpus manifest has not been loaded yet',
      true
    )
  }
  if (corpus.status === 'unavailable') {
    return noDocument(pathname, 'corpus_unavailable', corpus.message, corpus.retryable)
  }

  // Resolve by (version, ref) rather than by URL. The document id is what
  // Docusaurus itself considers active, and #474 emits every loaded version, so
  // this is exact for historical and upcoming versions too — no base URL,
  // trailing slash, or version-path spelling can change the answer.
  const entry = corpus.store.findByRef(activeDocId, activeVersionName)
  if (!entry) {
    const message = `Docusaurus reports document id "${activeDocId}"${
      activeVersionName === undefined ? '' : ` (version "${activeVersionName}")`
    } as active for "${pathname}", but the #474 corpus manifest has no such document`
    return noDocument(pathname, 'unknown_active_document', message, false, {
      code: 'unknown_active_document',
      message,
      pathname,
      ref: activeDocId
    })
  }

  // A cross-check, not a second resolution path. `entry.permalink` was already
  // canonicalized at build time by this exact helper, so normalizing only the
  // route's own spelling (a deep link that omits the trailing slash, say) is
  // enough to make the two directly comparable. A mismatch means the corpus and
  // the built routes disagree about where this document lives — worth shouting
  // about, but not a reason to disown a document Docusaurus says is active.
  const routePermalink = canonicalizeDocusaurusPermalink(pathname, siteConfig)
  const mismatch = routePermalink !== entry.permalink

  return {
    pathname,
    active: {
      status: 'document',
      document: {
        ref: entry.ref,
        version: entry.version,
        isLast: entry.isLast,
        title: entry.title,
        permalink: entry.permalink,
        unlisted: entry.unlisted
      }
    },
    ...(mismatch
      ? {
          diagnostic: {
            code: 'permalink_mismatch' as const,
            message: `route "${pathname}" normalizes to "${routePermalink}", but the #474 corpus manifest records document "${entry.ref}" at "${entry.permalink}"`,
            pathname,
            ref: entry.ref
          }
        }
      : {})
  }
}
