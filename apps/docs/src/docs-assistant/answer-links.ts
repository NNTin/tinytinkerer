/**
 * Link surgery on a composed answer's Markdown source (issue #478).
 *
 * Parsed, never matched with a regex. A URL inside a fenced code block is prose
 * *about* a link and must survive untouched; the same URL in an emphasis span is
 * a real link and must not. Only a parser knows the difference — and #474
 * already established that this application reads Markdown through an AST, so
 * the walker, the offset helper, and the replacement applier are the corpus'
 * own rather than a second set that could drift from them.
 *
 * Two operations, both driven by the same ledger:
 *
 * - **which documents the answer cites**, so an obligation the model already met
 *   does not collect a second link in the footer;
 * - **demotion** of every documentation link the ledger does not authorize, so a
 *   fabricated URL is not merely uncited but unclickable.
 */
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import { getNodeOffsets, walkMarkdown, type MarkdownNode } from '../docs-corpus/markdown-ast'
import { applyReplacements, type Replacement } from '../docs-corpus/markdown-processing'
import {
  classifyDocumentationLink,
  type CanonicalDocumentationTarget,
  type DocumentationSite
} from './canonical-target'
import { isAuthorizedTarget, type DocumentationCitationLedger } from './citation-ledger'

/**
 * What replaces a fabricated link whose visible text *is* its URL.
 *
 * Keeping the text would leave a plausible-looking documentation address on
 * screen that goes nowhere — the failure this policy exists to prevent, minus
 * only the click. Nothing is invented in its place: the marker says what
 * happened and makes no claim about a page.
 */
export const REMOVED_LINK_TEXT = '(link removed)'

/**
 * GFM, but none of the corpus' authoring extensions. An assistant answer is
 * chat Markdown rendered by `content-markdown`, not authored MDX: parsing it
 * with directives and MDX enabled would recognise constructs the renderer never
 * honours, and the only thing that matters here is agreeing with the renderer
 * about what a link is.
 */
const answerParser = unified().use(remarkParse).use(remarkGfm)

type LinkNode = MarkdownNode & { url: string }

const isLinkNode = (node: MarkdownNode): node is LinkNode =>
  node.type === 'link' && typeof node.url === 'string'

type LocatedLink = {
  node: LinkNode
  /** `null` for an unresolvable URL: demotable, but it names no document. */
  target: CanonicalDocumentationTarget | null
  authorized: boolean
}

/**
 * Every documentation link in the answer, with the ledger's verdict attached.
 *
 * `linkReference` is deliberately not collected. The assistant's Markdown
 * renderer drops definitions and link references outright (see
 * `content-markdown`'s `parse-markdown-content`), so `[text][ref]` never becomes
 * an anchor: there is nothing to demote, and rewriting it would alter text the
 * reader sees for no safety gain.
 */
const locateDocumentationLinks = (
  source: string,
  ledger: DocumentationCitationLedger,
  site: DocumentationSite
): LocatedLink[] => {
  const located: LocatedLink[] = []
  const tree: MarkdownNode = answerParser.parse(source)
  walkMarkdown(tree, (node) => {
    if (!isLinkNode(node)) {
      return
    }
    const classification = classifyDocumentationLink(node.url, site)
    if (classification.kind === 'outside-policy') {
      return
    }
    if (classification.kind === 'unresolvable') {
      // Nothing to cite and nothing to compare, but it must not stay clickable.
      located.push({ node, target: null, authorized: false })
      return
    }
    located.push({
      node,
      target: classification.target,
      // A query string can never be authorized — no tool result produces one.
      authorized: !classification.hasQuery && isAuthorizedTarget(ledger, classification.target)
    })
  })
  return located
}

/**
 * The documents this answer already cites — authorized links only.
 *
 * An unauthorized link cannot settle an obligation: it is about to be demoted,
 * and counting it as a citation would let a fabricated URL suppress the real one
 * that should have taken its place.
 */
export const citedDocuments = (
  source: string,
  ledger: DocumentationCitationLedger,
  site: DocumentationSite
): ReadonlySet<string> => {
  const cited = new Set<string>()
  for (const link of locateDocumentationLinks(source, ledger, site)) {
    if (link.authorized && link.target) {
      cited.add(link.target.document)
    }
  }
  return cited
}

/**
 * Strips the clickability from every documentation link the ledger does not
 * authorize, leaving the surrounding prose exactly as the model wrote it.
 *
 * An invented target is never repaired by matching it to a similar real page. A
 * citation quietly redirected to a different document is the worse failure of
 * the two, because it still looks like evidence.
 */
export const demoteUnauthorizedLinks = (
  source: string,
  ledger: DocumentationCitationLedger,
  site: DocumentationSite
): string => {
  const replacements: Replacement[] = []
  for (const link of locateDocumentationLinks(source, ledger, site)) {
    if (link.authorized) {
      continue
    }
    const offsets = getNodeOffsets(link.node)
    if (!offsets) {
      // No offsets means no safe edit. The rendered-content policy is the
      // backstop that stops this link being clickable regardless.
      continue
    }
    replacements.push({ ...offsets, value: demotedText(source, link.node) })
  }
  return replacements.length === 0 ? source : applyReplacements(source, replacements)
}

/**
 * What a demoted link leaves behind: its own visible text, or the removal marker
 * when that text is only the URL again (a bare or autolinked address).
 *
 * The inner text is sliced from the SOURCE rather than re-serialized, so
 * emphasis and inline code inside the link text survive demotion byte for byte.
 */
const demotedText = (source: string, node: LinkNode): string => {
  const children = node.children ?? []
  const first = children[0]
  const last = children[children.length - 1]
  const start = first ? getNodeOffsets(first)?.start : undefined
  const end = last ? getNodeOffsets(last)?.end : undefined
  if (start === undefined || end === undefined || end <= start) {
    return REMOVED_LINK_TEXT
  }
  const inner = source.slice(start, end)
  return inner.trim() === node.url.trim() ? REMOVED_LINK_TEXT : inner
}
