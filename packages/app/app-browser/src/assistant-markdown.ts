/**
 * The assistant's Markdown parser, as a server-safe facade.
 *
 * This is the exact parser the transcript renders with, and an app needs it as a
 * **value** for one reason: to verify that Markdown it composed actually became
 * the nodes it intended (issue #478 — a citation footer appended to an answer
 * whose last fence was never closed is swallowed into that code block, so the
 * only honest check is to parse the result and look for the link).
 *
 * A facade rather than the barrel, for the same reason `documentation-corpus` is
 * one: the barrel reaches `virtual:pwa-register` and cannot load outside a Vite
 * app build. `content-markdown` is a pure parser with no browser dependency, so
 * it loads anywhere this facade does.
 */
export { createMarkdownContentSession, parseMarkdownContent } from '@tinytinkerer/content-markdown'
export type { ContentDocument, InlineNode, BlockNode } from '@tinytinkerer/contracts'
