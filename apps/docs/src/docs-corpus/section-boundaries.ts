import GithubSlugger from 'github-slugger'
import type {
  DocumentationCorpusOutlineItem,
  DocumentationCorpusSection
} from '@tinytinkerer/app-browser'
import { createHeadingIdentity } from './docusaurus-compatibility'
import type { MarkdownNode } from './markdown-ast'
import { getNodeOffsets, walkMarkdown } from './markdown-ast'
import type { Replacement } from './markdown-processing'
import { isInsideReplacement, mapOffset } from './markdown-processing'

type ContainerWrapperRecord = {
  start: number
  end: number
  closingStart: number
  prefix: string
  suffix: string
}

export type HeadingRecord = {
  identityAnchor: string
  anchor: string | null
  title: string
  depth: number
  start: number
  contentStart: number
  end: number
  wrappers: ContainerWrapperRecord[]
  preservedComment?: { start: number; end: number }
}

const collectContainerWrappers = (
  ancestors: readonly MarkdownNode[],
  source: string
): ContainerWrapperRecord[] =>
  ancestors.flatMap((ancestor) => {
    if (ancestor.type !== 'containerDirective') return []
    const offsets = getNodeOffsets(ancestor)
    if (!offsets) return []
    const openingLineStart = source.lastIndexOf('\n', offsets.start - 1) + 1
    const openingNewline = source.indexOf('\n', offsets.start)
    const openingEnd = openingNewline === -1 ? offsets.end : openingNewline + 1
    const closingStart = source.lastIndexOf('\n', offsets.end - 1) + 1
    const opening = source.slice(openingLineStart, openingEnd)
    const closing = source.slice(closingStart, offsets.end)
    return [
      {
        start: openingLineStart,
        end: offsets.end,
        closingStart,
        prefix: `${opening}${opening.endsWith('\n') ? '' : '\n'}\n`,
        suffix: `\n${closing}${closing.endsWith('\n') ? '' : '\n'}`
      }
    ]
  })

export const collectHeadings = (tree: MarkdownNode, source: string): HeadingRecord[] => {
  const headings: HeadingRecord[] = []
  const slugger = new GithubSlugger()
  walkMarkdown(tree, (node, _parent, ancestors) => {
    if (node.type !== 'heading' || typeof node.depth !== 'number') return
    const offsets = getNodeOffsets(node)
    if (!offsets) return
    const identity = createHeadingIdentity(node, source, slugger)
    headings.push({
      ...identity,
      depth: node.depth,
      start: source.lastIndexOf('\n', offsets.start - 1) + 1,
      contentStart: offsets.end,
      end: offsets.end,
      wrappers: collectContainerWrappers(ancestors, source)
    })
  })
  return headings
}

export const remapHeadings = (
  headings: HeadingRecord[],
  replacements: Replacement[],
  leadingWhitespace: number,
  markdown: string
): HeadingRecord[] =>
  headings
    .filter((heading) => !isInsideReplacement(heading, replacements))
    .map((heading) => {
      const mappedStart = Math.max(0, mapOffset(heading.start, replacements) - leadingWhitespace)
      const mappedContentStart = Math.max(
        mappedStart,
        mapOffset(heading.contentStart, replacements) - leadingWhitespace
      )
      const contentStart =
        markdown[mappedContentStart] === '\n' ? mappedContentStart + 1 : mappedContentStart
      return {
        ...heading,
        start: mappedStart,
        contentStart,
        end: Math.max(mappedStart, mapOffset(heading.end, replacements) - leadingWhitespace),
        wrappers: heading.wrappers.map((wrapper) => ({
          ...wrapper,
          start: Math.max(0, mapOffset(wrapper.start, replacements) - leadingWhitespace),
          end: Math.max(0, mapOffset(wrapper.end, replacements) - leadingWhitespace),
          closingStart: Math.max(
            0,
            mapOffset(wrapper.closingStart, replacements) - leadingWhitespace
          )
        }))
      }
    })

export const createOutline = (headings: HeadingRecord[]): DocumentationCorpusOutlineItem[] => {
  const roots: DocumentationCorpusOutlineItem[] = []
  const stack: DocumentationCorpusOutlineItem[] = []

  headings.forEach((heading, headingIndex) => {
    if (heading.anchor === null) {
      stack.length = 0
      return
    }
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

export const createSections = (
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
      selectionPrefix: '',
      selectionSuffix: '',
      characterCount: markdown.length
    }
  ]

  headings.forEach((heading, headingIndex) => {
    const nextBoundary = headings
      .slice(headingIndex + 1)
      .find((candidate) => candidate.depth <= heading.depth)
    const currentWrappers = new Set(
      heading.wrappers.map((wrapper) => `${wrapper.start}:${wrapper.end}`)
    )
    const endOffset =
      nextBoundary?.wrappers
        .filter((wrapper) => !currentWrappers.has(`${wrapper.start}:${wrapper.end}`))
        .reduce((boundary, wrapper) => Math.min(boundary, wrapper.start), nextBoundary.start) ??
      markdown.length
    const parent = [...headings.slice(0, headingIndex)]
      .reverse()
      .find((candidate) => candidate.depth < heading.depth && candidate.anchor !== null)
    const selectionPrefix = heading.wrappers.map((wrapper) => wrapper.prefix).join('')
    const selectionSuffix = [...heading.wrappers]
      .reverse()
      .filter((wrapper) => endOffset <= wrapper.closingStart)
      .map((wrapper) => wrapper.suffix)
      .join('')
    sections.push({
      index: headingIndex + 1,
      anchor: heading.anchor,
      title: heading.title,
      depth: heading.depth,
      parentAnchor: parent?.anchor ?? null,
      startOffset: heading.start,
      contentStartOffset: heading.contentStart,
      endOffset,
      selectionPrefix,
      selectionSuffix,
      characterCount: selectionPrefix.length + endOffset - heading.start + selectionSuffix.length
    })
  })
  return sections
}
