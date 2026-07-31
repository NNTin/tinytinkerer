/**
 * The documentation assistant's bridge between Docusaurus routing and "which
 * document am I on?" (issue #476).
 *
 * Mounted once from `@theme/Root` (src/theme/Root.tsx), which Docusaurus keeps
 * mounted for the lifetime of the SPA — above the layout and outside the route
 * tree — so this provider survives every client-side navigation. Consumers read
 * it with `useDocsPageContext()`.
 *
 * Two properties are the whole point of this file:
 *
 * 1. **Nothing is read from the DOM.** Identity comes from Docusaurus'
 *    `useActiveDocContext`, and everything exposed about the document comes from
 *    the #474 corpus manifest built out of authored Markdown.
 * 2. **The value is atomic.** `pathname` and the resolved identity are derived
 *    from the same render, driven by the same `useLocation()` the router
 *    updates. There is no effect that copies the route into state afterwards, so
 *    there is no window in which a tool could observe the previous document id
 *    beside the new pathname.
 *
 * Because the identity follows the *router*, it leads the painted page during
 * Docusaurus' `PendingNavigation` chunk-preload window: the context reports the
 * destination document while the browser is still showing the previous one for
 * a few milliseconds. That is the intended reading of "current page" here — the
 * page being navigated to — and it is the only definition available without
 * inspecting rendered output, which #476 forbids.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'
import { useActiveDocContext } from '@docusaurus/plugin-content-docs/client'
import { useLocation } from '@docusaurus/router'
import useDocusaurusContext from '@docusaurus/useDocusaurusContext'
import { loadDocumentationCorpusStore } from '../docs-corpus/manifest-store'
import {
  resolveDocsPageContext,
  type DocsCorpusLookup,
  type DocsPageDiagnostic,
  type DocsPageResolution
} from './active-document'
import { useIsomorphicLayoutEffect } from './isomorphic-layout-effect'
import { publishDocsPageSnapshot } from './page-snapshot'

/**
 * What `useDocsPageContext()` returns: one route's resolution, plus the one
 * operation a consumer can perform.
 *
 * `retryCorpus` lives here rather than in the pure resolver because it is the
 * provider's async state it acts on. It is a no-op unless the corpus is in a
 * *retryable* failure — a consumer may call it whenever it sees
 * `retryable: true` without having to know whether a load is already running.
 */
export type DocsPageContextValue = DocsPageResolution & {
  /** Re-attempt a retryable corpus-manifest load. Stable across renders. */
  retryCorpus: () => void
}

/**
 * The docs plugin instance the site's documentation routes come from. This site
 * runs exactly one, from the classic preset, so the default id is the whole
 * story; naming it here keeps that assumption visible rather than implied by an
 * `undefined` argument.
 */
const DOCS_PLUGIN_ID = 'default'

const DocsPageContext = createContext<DocsPageContextValue | null>(null)

/**
 * Reads the current documentation page context.
 *
 * Throws outside the provider rather than inventing a "no document" value: the
 * provider is mounted unconditionally by `@theme/Root`, so its absence is a
 * wiring mistake, and silently returning a plausible-looking answer would let a
 * tool report "this page has no document" for every page on the site.
 */
export const useDocsPageContext = (): DocsPageContextValue => {
  const value = useContext(DocsPageContext)
  if (!value) {
    throw new Error(
      'useDocsPageContext must be used inside <DocsPageProvider> (mounted by src/theme/Root.tsx)'
    )
  }
  return value
}

/**
 * Joined with an escaped NUL — the same separator the corpus store keys its
 * cache with, and the same escape, since `check:text-files` rejects a literal
 * NUL byte in a source file. It cannot occur in a diagnostic code, a route, or
 * a document id, so no two distinct anomalies can collide on one key and
 * silence each other's report.
 */
const diagnosticKey = (diagnostic: DocsPageDiagnostic): string =>
  `${diagnostic.code}\u0000${diagnostic.pathname}\u0000${diagnostic.ref}`

export const DocsPageProvider = ({ children }: { children: ReactNode }): ReactNode => {
  const { siteConfig } = useDocusaurusContext()
  const { baseUrl, trailingSlash } = siteConfig
  const { pathname } = useLocation()
  const { activeDoc, activeVersion } = useActiveDocContext(DOCS_PLUGIN_ID)

  // `pending` is also what static rendering and the first hydration render
  // produce, on both sides, because the effect below never runs on the server.
  // Nothing in this provider touches `window` or `document`.
  const [corpus, setCorpus] = useState<DocsCorpusLookup>({ status: 'pending' })
  // Bumped by `retryCorpus` to re-run the load effect. Without it a retryable
  // failure would be permanent: this provider is mounted by `@theme/Root` for
  // the whole life of the SPA, and `baseUrl`/`trailingSlash` never change
  // within a session, so the effect would run exactly once no matter how many
  // routes the reader visits.
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    // Loaded on every route, not only document routes. The store coalesces and
    // caches, so this costs one small manifest request per session, and it means
    // a navigation from `/search` into a document resolves immediately instead
    // of opening a fresh "corpus_pending" window at exactly the moment a reader
    // is most likely to ask the assistant something.
    void loadDocumentationCorpusStore({ baseUrl, trailingSlash }).then((outcome) => {
      if (cancelled) return
      setCorpus(
        outcome.ok
          ? { status: 'ready', store: outcome.store }
          : {
              status: 'unavailable',
              code: outcome.code,
              message: outcome.message,
              retryable: outcome.retryable
            }
      )
    })
    return () => {
      cancelled = true
    }
  }, [baseUrl, trailingSlash, attempt])

  // Read through a ref so the callback below can keep one identity forever.
  // Depending on `corpus` directly would republish the context value — and
  // re-render every consumer — every time the corpus state changed.
  const corpusRef = useRef(corpus)
  useEffect(() => {
    corpusRef.current = corpus
  }, [corpus])

  const retryCorpus = useCallback(() => {
    const current = corpusRef.current
    // Gated deliberately. A tool that retries on every failure must not be able
    // to restart a healthy load, hammer the network while one is in flight, or
    // re-fetch a manifest whose schema or hash will never validate.
    if (current.status !== 'unavailable' || !current.retryable) return
    // Back to `pending` before the fresh load, so a consumer never reads a
    // stale failure while its own retry is running. The store evicts retryable
    // failures from its cache, so the next call genuinely re-fetches.
    setCorpus({ status: 'pending' })
    setAttempt((n) => n + 1)
  }, [])

  const activeDocId = activeDoc?.id
  const activeVersionName = activeVersion?.name
  // Memoized on primitives: `useActiveDocContext` returns a freshly built object
  // on every render, so depending on it directly would publish a new context
  // value (and re-render every consumer) on every render of the whole app.
  const resolution = useMemo<DocsPageResolution>(
    () =>
      resolveDocsPageContext(
        {
          pathname,
          ...(activeDocId === undefined ? {} : { activeDocId }),
          ...(activeVersionName === undefined ? {} : { activeVersionName })
        },
        corpus,
        { baseUrl, trailingSlash }
      ),
    [pathname, activeDocId, activeVersionName, corpus, baseUrl, trailingSlash]
  )

  const value = useMemo<DocsPageContextValue>(
    () => ({ ...resolution, retryCorpus }),
    [resolution, retryCorpus]
  )

  // Republished for non-React consumers — #477's documentation tools run from
  // the agent runtime, outside this tree, and must answer from the same
  // resolution rather than resolving the route a second way.
  //
  // A **layout** effect, not a passive one. Passive effects flush after paint,
  // so a tool call landing between an SPA route commit and that flush would
  // have read the previous route's document — reintroducing exactly the
  // stale-page window #476 eliminated by deriving pathname and identity in the
  // same render. A layout effect runs synchronously at commit, so the published
  // snapshot is never older than the committed route.
  //
  // Still an effect rather than a render-phase write: only a render React
  // actually committed may become a tool's answer, and static rendering (where
  // no effect runs) must publish nothing at all.
  useIsomorphicLayoutEffect(() => {
    publishDocsPageSnapshot({ ...value, siteConfig: { baseUrl, trailingSlash } })
  }, [value, baseUrl, trailingSlash])

  // Route/manifest mapping diagnostics. Reported once per distinct anomaly so a
  // page that re-renders (or is revisited) does not bury the console, and from
  // an effect so static rendering stays silent and side-effect free. Keyed on
  // the resolution rather than the published value, since only the resolution
  // can carry a diagnostic.
  const reported = useRef<Set<string>>(new Set())
  useEffect(() => {
    const { diagnostic } = resolution
    if (!diagnostic) return
    const key = diagnosticKey(diagnostic)
    if (reported.current.has(key)) return
    reported.current.add(key)
    console.warn(`[docs-page] ${diagnostic.message}`)
  }, [resolution])

  return <DocsPageContext.Provider value={value}>{children}</DocsPageContext.Provider>
}
