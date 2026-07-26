import GithubSlugger from 'github-slugger'
import { toString } from 'mdast-util-to-string'
import { applyTrailingSlash } from '@docusaurus/utils-common'
import type { MarkdownNode } from './markdown-ast'
import { getNodeOffsets } from './markdown-ast'

export type HeadingIdentity = {
  /** Slug identity used for Docusaurus duplicate accounting, including H1. */
  identityAnchor: string
  /** H1 is deliberately unaddressable in theme-classic. */
  anchor: string | null
  title: string
  preservedComment?: { start: number; end: number }
}

/**
 * MDX treats `{#custom-id}` as JavaScript. Docusaurus escapes classic heading
 * ids before parsing. Match that behavior without changing fenced code.
 */
export const escapeClassicHeadingIds = (source: string): string => {
  const lines = source.split('\n')
  let fenceMarker: '`' | '~' | null = null
  let fenceLength = 0

  return lines
    .map((line) => {
      const fence = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1]
      if (fence) {
        const marker = fence[0] as '`' | '~'
        if (fenceMarker === null) {
          fenceMarker = marker
          fenceLength = fence.length
        } else if (
          marker === fenceMarker &&
          fence.length >= fenceLength &&
          line.slice(line.indexOf(fence) + fence.length).trim() === ''
        ) {
          fenceMarker = null
          fenceLength = 0
        }
        return line
      }

      if (fenceMarker !== null || !/^#{1,6}(?!#)/.test(line)) return line
      return line.replace(/(^|[^\\])\{#/g, '$1\\{#')
    })
    .join('\n')
}

const parseClassicHeadingId = (text: string): { text: string; id?: string } => {
  // Kept in sync with @docusaurus/utils' parseMarkdownHeadingId classic
  // syntax: the id is a final `{#...}` and cannot itself contain `{#` or `}`.
  const match = /\s*\{#(?<id>(?:.(?!\{#|\}))*.)\}$/.exec(text)
  if (!match?.groups?.id) return { text }
  return { text: text.replace(match[0], ''), id: match.groups.id.trim() }
}

export const commentHeadingId = (node: MarkdownNode | undefined): string | undefined => {
  if (node?.type !== 'mdxTextExpression' || !node.value) return undefined
  const comment = /^\/\*([\s\S]*)\*\/$/.exec(node.value.trim())?.[1]
  const firstPart = comment?.trim().split(' ')[0]
  return firstPart?.startsWith('#') && firstPart.length > 1 ? firstPart.slice(1) : undefined
}

const htmlHeadingId = (
  heading: MarkdownNode,
  source: string
): { id: string; range: { start: number; end: number } } | undefined => {
  const offsets = getNodeOffsets(heading)
  if (!offsets) return undefined
  const authoredHeading = source.slice(offsets.start, offsets.end)
  const match = /<!--\s*(#[^\s]+)(?:\s[\s\S]*?)?-->\s*$/.exec(authoredHeading)
  if (!match?.[1]) return undefined
  const start = offsets.start + (match.index ?? 0)
  return {
    id: match[1].slice(1),
    range: { start, end: offsets.end }
  }
}

export const createHeadingIdentity = (
  heading: MarkdownNode,
  source: string,
  slugger: GithubSlugger
): HeadingIdentity => {
  const children = heading.children ?? []
  const mdxCommentId = commentHeadingId(children.at(-1))
  const visibleChildren = mdxCommentId ? children.slice(0, -1) : children
  const textChildren = visibleChildren.filter(({ type }) => !['html', 'jsx'].includes(type))
  const visibleHeading = { ...heading, children: visibleChildren }
  const headingText = toString(
    textChildren.length > 0 ? { ...visibleHeading, children: textChildren } : visibleHeading
  ).trimEnd()
  const htmlCommentId = htmlHeadingId(heading, source)
  const classic = parseClassicHeadingId(headingText)
  const explicitId = mdxCommentId ?? htmlCommentId?.id ?? classic.id
  // Explicit ids bypass Docusaurus' slugger. Generated H1 ids still occupy a
  // duplicate slot even though theme-classic does not render the H1 id.
  const identityAnchor = explicitId ?? slugger.slug(classic.text)

  return {
    identityAnchor,
    anchor: heading.depth === 1 ? null : identityAnchor,
    title: classic.text,
    ...(htmlCommentId ? { preservedComment: htmlCommentId.range } : {})
  }
}

export const canonicalizeDocusaurusPermalink = (
  permalink: string,
  options: { baseUrl: string; trailingSlash: boolean | undefined }
): string => applyTrailingSlash(permalink, options)
