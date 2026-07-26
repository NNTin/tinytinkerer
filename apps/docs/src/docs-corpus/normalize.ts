import GithubSlugger from 'github-slugger'
import { toString } from 'mdast-util-to-string'
import remarkComment from '@slorber/remark-comment'
import remarkDirective from 'remark-directive'
import remarkFrontmatter from 'remark-frontmatter'
import remarkGfm from 'remark-gfm'
import remarkMdx from 'remark-mdx'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import type {
  DocumentationCorpusOutlineItem,
  DocumentationCorpusSection
} from '@tinytinkerer/app-browser'

type Position = {
  start: { offset?: number }
  end: { offset?: number }
}

type MarkdownNode = {
  type: string
  value?: string
  depth?: number
  children?: MarkdownNode[]
  position?: Position
}

type Replacement = {
  start: number
  end: number
  value: string
}

type HeadingRecord = {
  anchor: string
  title: string
  depth: number
  start: number
  contentStart: number
  end: number
}

export type NormalizedDocumentation = {
  markdown: string
  outline: DocumentationCorpusOutlineItem[]
  sections: DocumentationCorpusSection[]
}

const FLOW_MDX_MARKER =
  '> **Non-executable MDX omitted.** Interactive component or expression output is not part of this authored documentation corpus.'
const TEXT_MDX_MARKER = '[non-executable MDX expression omitted]'

const markdownProcessor = unified()
  .use(remarkParse)
  .use(remarkFrontmatter, ['yaml', 'toml'])
  .use(remarkGfm)
  .use(remarkComment)
  .use(remarkDirective)

// Docusaurus' MDX processor installs its comment compatibility extension after
// MDX itself; ordering matters because both claim `<...` micromark constructs.
const mdxProcessor = unified()
  .use(remarkParse)
  .use(remarkFrontmatter, ['yaml', 'toml'])
  .use(remarkMdx)
  .use(remarkGfm)
  .use(remarkComment)
  .use(remarkDirective)

const getOffsets = (node: MarkdownNode): { start: number; end: number } | null => {
  const start = node.position?.start.offset
  const end = node.position?.end.offset
  return typeof start === 'number' && typeof end === 'number' ? { start, end } : null
}

/**
 * MDX treats `{#custom-id}` as a JavaScript expression. Docusaurus escapes
 * classic heading ids before parsing. Do the same, but unlike Docusaurus'
 * broad preprocessor, leave fenced code byte-for-byte intact.
 */
const escapeClassicHeadingIds = (source: string): string => {
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

const commentHeadingId = (node: MarkdownNode | undefined): string | undefined => {
  if (!node) return undefined
  let comment: string | undefined
  if (node.type === 'mdxTextExpression' && node.value) {
    comment = /^\/\*([\s\S]*)\*\/$/.exec(node.value.trim())?.[1]
  } else if (node.type === 'html' && node.value) {
    comment = /^<!--([\s\S]*)-->$/.exec(node.value.trim())?.[1]
  }
  if (comment === undefined) return undefined
  const firstPart = comment.trim().split(' ')[0]
  return firstPart?.startsWith('#') && firstPart.length > 1 ? firstPart.slice(1) : undefined
}

const headingTextAndId = (heading: MarkdownNode): { title: string; id?: string } => {
  const children = heading.children ?? []
  const explicitCommentId = commentHeadingId(children.at(-1))
  const visibleChildren = explicitCommentId ? children.slice(0, -1) : children
  const textChildren = visibleChildren.filter(({ type }) => !['html', 'jsx'].includes(type))
  const visibleHeading = { ...heading, children: visibleChildren }
  const headingText = toString(
    textChildren.length > 0 ? { ...visibleHeading, children: textChildren } : visibleHeading
  ).trimEnd()
  if (explicitCommentId) return { title: headingText, id: explicitCommentId }
  const classic = parseClassicHeadingId(headingText)
  return { title: classic.text, ...(classic.id ? { id: classic.id } : {}) }
}

const walk = (
  node: MarkdownNode,
  visit: (node: MarkdownNode, parent: MarkdownNode | null) => boolean | void,
  parent: MarkdownNode | null = null
): void => {
  if (visit(node, parent) === false) return
  for (const child of node.children ?? []) walk(child, visit, node)
}

const collectHeadings = (tree: MarkdownNode): HeadingRecord[] => {
  const headings: HeadingRecord[] = []
  const slugger = new GithubSlugger()
  walk(tree, (node) => {
    if (node.type !== 'heading' || typeof node.depth !== 'number') return
    const offsets = getOffsets(node)
    if (!offsets) return
    const { title, id } = headingTextAndId(node)
    // Explicit ids bypass Docusaurus' slugger; generated ids use the same
    // github-slugger version and document-order duplicate accounting.
    const anchor = id ?? slugger.slug(title)
    headings.push({
      anchor,
      title,
      depth: node.depth,
      start: offsets.start,
      contentStart: offsets.end,
      end: offsets.end
    })
  })
  return headings
}

const isPreservedHeadingComment = (node: MarkdownNode, parent: MarkdownNode | null): boolean =>
  parent?.type === 'heading' &&
  parent.children?.at(-1) === node &&
  commentHeadingId(node) !== undefined

const collectReplacements = (tree: MarkdownNode): Replacement[] => {
  const replacements: Replacement[] = []
  walk(tree, (node, parent) => {
    const offsets = getOffsets(node)
    if (!offsets) return

    if (node.type === 'yaml' || node.type === 'toml' || node.type === 'mdxjsEsm') {
      replacements.push({ ...offsets, value: '' })
      return false
    }
    if (node.type === 'mdxJsxFlowElement' || node.type === 'mdxFlowExpression') {
      replacements.push({ ...offsets, value: FLOW_MDX_MARKER })
      return false
    }
    if (
      node.type === 'mdxJsxTextElement' ||
      (node.type === 'mdxTextExpression' && !isPreservedHeadingComment(node, parent))
    ) {
      replacements.push({ ...offsets, value: TEXT_MDX_MARKER })
      return false
    }
  })
  return replacements.sort((left, right) => left.start - right.start)
}

const isInsideReplacement = (heading: HeadingRecord, replacements: Replacement[]): boolean =>
  replacements.some(
    (replacement) => replacement.start <= heading.start && replacement.end >= heading.end
  )

const mapOffset = (offset: number, replacements: Replacement[]): number => {
  let mapped = offset
  for (const replacement of replacements) {
    if (replacement.end <= offset) {
      mapped += replacement.value.length - (replacement.end - replacement.start)
    }
  }
  return mapped
}

const applyReplacements = (source: string, replacements: Replacement[]): string => {
  let normalized = source
  for (const replacement of [...replacements].reverse()) {
    normalized =
      normalized.slice(0, replacement.start) + replacement.value + normalized.slice(replacement.end)
  }
  return normalized
}

const createOutline = (headings: HeadingRecord[]): DocumentationCorpusOutlineItem[] => {
  const roots: DocumentationCorpusOutlineItem[] = []
  const stack: DocumentationCorpusOutlineItem[] = []

  headings.forEach((heading, headingIndex) => {
    const item: DocumentationCorpusOutlineItem = {
      anchor: heading.anchor,
      title: heading.title,
      depth: heading.depth,
      sectionIndex: headingIndex + 1,
      children: []
    }
    while ((stack.at(-1)?.depth ?? 0) >= heading.depth) stack.pop()
    const parent = stack.at(-1)
    if (parent) parent.children.push(item)
    else roots.push(item)
    stack.push(item)
  })

  return roots
}

const createSections = (
  title: string,
  markdown: string,
  headings: HeadingRecord[]
): DocumentationCorpusSection[] => {
  const sections: DocumentationCorpusSection[] = [
    {
      index: 0,
      anchor: null,
      title,
      depth: 0,
      parentAnchor: null,
      startOffset: 0,
      contentStartOffset: 0,
      endOffset: markdown.length,
      characterCount: markdown.length
    }
  ]

  headings.forEach((heading, headingIndex) => {
    const nextBoundary = headings
      .slice(headingIndex + 1)
      .find((candidate) => candidate.depth <= heading.depth)
    const endOffset = nextBoundary?.start ?? markdown.length
    const parent = [...headings.slice(0, headingIndex)]
      .reverse()
      .find((candidate) => candidate.depth < heading.depth)
    sections.push({
      index: headingIndex + 1,
      anchor: heading.anchor,
      title: heading.title,
      depth: heading.depth,
      parentAnchor: parent?.anchor ?? null,
      startOffset: heading.start,
      contentStartOffset: heading.contentStart,
      endOffset,
      characterCount: endOffset - heading.start
    })
  })
  return sections
}

/**
 * Convert authored Markdown/MDX into the deterministic, non-executable corpus
 * representation while deriving Docusaurus-compatible section anchors.
 */
export const normalizeDocumentation = (
  source: string,
  documentTitle: string,
  format: 'md' | 'mdx' = 'mdx'
): NormalizedDocumentation => {
  const canonicalSource = escapeClassicHeadingIds(
    source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  )
  const tree = (format === 'mdx' ? mdxProcessor : markdownProcessor).parse(
    canonicalSource
  ) as MarkdownNode
  const allHeadings = collectHeadings(tree)
  const replacements = collectReplacements(tree)
  const replaced = applyReplacements(canonicalSource, replacements)
  const leadingWhitespace = /^\s*/.exec(replaced)?.[0].length ?? 0
  const trimmed = replaced.trim()
  const markdown = trimmed.length > 0 ? `${trimmed}\n` : ''

  const headings = allHeadings
    .filter((heading) => !isInsideReplacement(heading, replacements))
    .map((heading) => {
      const mappedStart = Math.max(0, mapOffset(heading.start, replacements) - leadingWhitespace)
      const mappedContentStart = Math.max(
        mappedStart,
        mapOffset(heading.contentStart, replacements) - leadingWhitespace
      )
      // A heading's content starts after the Markdown heading syntax. Include
      // its line ending so slicing body content does not begin with a blank.
      const contentStart =
        markdown[mappedContentStart] === '\n' ? mappedContentStart + 1 : mappedContentStart
      return {
        ...heading,
        start: mappedStart,
        contentStart,
        end: Math.max(mappedStart, mapOffset(heading.end, replacements) - leadingWhitespace)
      }
    })

  return {
    markdown,
    outline: createOutline(headings),
    sections: createSections(documentTitle, markdown, headings)
  }
}
