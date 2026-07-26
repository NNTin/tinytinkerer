import remarkComment from '@slorber/remark-comment'
import remarkDirective from 'remark-directive'
import remarkFrontmatter from 'remark-frontmatter'
import remarkGfm from 'remark-gfm'
import remarkMdx from 'remark-mdx'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import { commentHeadingId, escapeClassicHeadingIds } from './docusaurus-compatibility'
import type { MarkdownNode } from './markdown-ast'
import { getNodeOffsets, walkMarkdown } from './markdown-ast'

export type Replacement = {
  start: number
  end: number
  value: string
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

// Ordering matches Docusaurus: MDX claims expressions before comment syntax.
const mdxProcessor = unified()
  .use(remarkParse)
  .use(remarkFrontmatter, ['yaml', 'toml'])
  .use(remarkMdx)
  .use(remarkGfm)
  .use(remarkComment)
  .use(remarkDirective)

// remark-comment deliberately removes HTML comments from the primary AST. A
// plain Markdown parse supplies their exact authored ranges for normalization.
const htmlCommentProcessor = unified().use(remarkParse)

export const parseDocumentation = (
  source: string,
  format: 'md' | 'mdx'
): { source: string; tree: MarkdownNode } => {
  const canonicalSource = escapeClassicHeadingIds(
    source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  )
  return {
    source: canonicalSource,
    tree: (format === 'mdx' ? mdxProcessor : markdownProcessor).parse(canonicalSource)
  }
}

const isCommentExpression = (node: MarkdownNode): boolean =>
  /^\/\*[\s\S]*\*\/$/.test(node.value?.trim() ?? '')

const isPreservedMdxHeadingComment = (node: MarkdownNode, parent: MarkdownNode | null): boolean =>
  parent?.type === 'heading' &&
  parent.children?.at(-1) === node &&
  commentHeadingId(node) !== undefined

export const collectReplacements = (
  tree: MarkdownNode,
  source: string,
  preservedComments: ReadonlySet<string>
): Replacement[] => {
  const replacements: Replacement[] = []

  walkMarkdown(tree, (node, parent) => {
    const offsets = getNodeOffsets(node)
    if (!offsets) return

    if (node.type === 'yaml' || node.type === 'toml' || node.type === 'mdxjsEsm') {
      replacements.push({ ...offsets, value: '' })
      return false
    }
    if (node.type === 'mdxFlowExpression') {
      replacements.push({ ...offsets, value: isCommentExpression(node) ? '' : FLOW_MDX_MARKER })
      return false
    }
    if (node.type === 'mdxJsxFlowElement') {
      replacements.push({ ...offsets, value: FLOW_MDX_MARKER })
      return false
    }
    if (node.type === 'mdxTextExpression') {
      if (isPreservedMdxHeadingComment(node, parent)) return
      replacements.push({ ...offsets, value: isCommentExpression(node) ? '' : TEXT_MDX_MARKER })
      return false
    }
    if (node.type === 'mdxJsxTextElement') {
      replacements.push({ ...offsets, value: TEXT_MDX_MARKER })
      return false
    }
  })

  const commentTree = htmlCommentProcessor.parse(source) as MarkdownNode
  walkMarkdown(commentTree, (node) => {
    if (node.type !== 'html' || !/^<!--[\s\S]*-->$/.test(node.value?.trim() ?? '')) return
    const offsets = getNodeOffsets(node)
    if (!offsets || preservedComments.has(`${offsets.start}:${offsets.end}`)) return
    replacements.push({ ...offsets, value: '' })
  })

  return replacements.sort((left, right) => left.start - right.start)
}

export const isInsideReplacement = (
  range: { start: number; end: number },
  replacements: Replacement[]
): boolean =>
  replacements.some(
    (replacement) => replacement.start <= range.start && replacement.end >= range.end
  )

export const mapOffset = (offset: number, replacements: Replacement[]): number => {
  let mapped = offset
  for (const replacement of replacements) {
    if (replacement.end <= offset) {
      mapped += replacement.value.length - (replacement.end - replacement.start)
    }
  }
  return mapped
}

export const applyReplacements = (source: string, replacements: Replacement[]): string => {
  let normalized = source
  for (const replacement of [...replacements].reverse()) {
    normalized =
      normalized.slice(0, replacement.start) + replacement.value + normalized.slice(replacement.end)
  }
  return normalized
}
