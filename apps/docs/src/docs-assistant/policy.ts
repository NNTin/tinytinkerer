/**
 * The documentation assistant's grounding and citation policy (issue #478),
 * assembled into the one object #479 hands to `createBrowserApp`.
 *
 * Three contributions, one ledger:
 *
 * | Contribution            | Runs                          | Guarantees                                    |
 * | ----------------------- | ----------------------------- | --------------------------------------------- |
 * | `instructions`          | every outgoing model request  | Markdown is reference content, links are real |
 * | `finalizeAnswer`        | once, before the answer persists | owed citations exist; fabricated links do not |
 * | `sanitizeRenderedContent` | every rendered snapshot     | a fabricated link is never clickable, even mid-stream |
 *
 * The runtime hands over only *successful* tool results, stripped of their
 * inputs (see `AppToolResultRecord`), so "a citation cannot come from a failed
 * call or from model text" holds structurally rather than by inspection here.
 */
import type { AppAssistantPolicy } from '@tinytinkerer/app-browser'
import { parseMarkdownContent } from '@tinytinkerer/app-browser/assistant-markdown'
import { readDocsPageSnapshot } from '../docs-page'
import type { SiteUrlConfig } from '../docs-corpus/manifest-store'
import { citedDocuments, demoteUnauthorizedLinks } from './answer-links'
import type { DocumentationSite } from './canonical-target'
import { buildDocumentationCitationLedger } from './citation-ledger'
import { documentationGroundingInstructions } from './grounding'
import { sanitizeRenderedDocumentationLinks } from './rendered-links'
import { attachSourcesFooter, missingCitations } from './sources-footer'
import { renderedDocumentationHrefs } from './rendered-links'

export type DocumentationAssistantPolicyDependencies = {
  /**
   * The site's `baseUrl`/`trailingSlash`. Injected for the same reason
   * `createDocumentationToolGroup` injects it: this policy runs outside React
   * and outside Docusaurus' context. Defaults to whatever #476 last published.
   */
  getSiteConfig?: () => SiteUrlConfig | undefined
  /**
   * This site's own origin, so an absolute `https://host/docs/x` and a relative
   * `/docs/x` are recognised as one target. Defaults to the browser's origin;
   * `null` outside a browser, which makes every absolute URL external and so
   * leaves it untouched — the conservative direction.
   */
  getOrigin?: () => string | null
}

const DEFAULT_SITE_CONFIG: SiteUrlConfig = { baseUrl: '/', trailingSlash: undefined }

const resolveSite = (
  dependencies: DocumentationAssistantPolicyDependencies
): DocumentationSite => ({
  siteConfig:
    dependencies.getSiteConfig?.() ?? readDocsPageSnapshot()?.siteConfig ?? DEFAULT_SITE_CONFIG,
  origin: dependencies.getOrigin
    ? dependencies.getOrigin()
    : typeof globalThis.location === 'undefined'
      ? null
      : globalThis.location.origin
})

export const createDocumentationAssistantPolicy = (
  dependencies: DocumentationAssistantPolicyDependencies = {}
): AppAssistantPolicy => ({
  instructions: documentationGroundingInstructions,

  finalizeAnswer: ({ source, results }) => {
    const site = resolveSite(dependencies)
    const ledger = buildDocumentationCitationLedger(results, site)
    // Demotion first: an unauthorized link must not count as a citation that
    // settles an obligation, and it is gone by the time the footer is built.
    const demoted = demoteUnauthorizedLinks(source, ledger, site)
    return attachSourcesFooter(
      demoted,
      missingCitations(ledger, citedDocuments(demoted, ledger, site)),
      // Verified against the PARSED document, and against the version the render
      // policy would actually mount — a citation that survives concatenation but
      // not sanitization is not a citation either.
      (candidate, expected) => {
        const rendered = sanitizeRenderedDocumentationLinks(
          parseMarkdownContent(candidate),
          ledger,
          site
        )
        const hrefs = new Set(renderedDocumentationHrefs(rendered))
        return expected.every((href) => hrefs.has(href))
      }
    )
  },

  prepareRenderedContent: ({ results }) => {
    // Compiled once per turn's results: schema validation and ledger
    // construction happen here, and the returned sanitizer runs per snapshot.
    const site = resolveSite(dependencies)
    const ledger = buildDocumentationCitationLedger(results, site)
    return (document) => sanitizeRenderedDocumentationLinks(document, ledger, site)
  }
})
