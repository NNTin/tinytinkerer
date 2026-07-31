type MarkdownPosition = {
  start: { offset?: number }
  end: { offset?: number }
}

export type MarkdownNode = {
  type: string
  value?: string
  depth?: number
  // Present on link/image/definition nodes. Read by #478's answer-link policy,
  // which walks assistant Markdown with this same structural node type.
  url?: string
  children?: MarkdownNode[]
  position?: MarkdownPosition
}

export const getNodeOffsets = (node: MarkdownNode): { start: number; end: number } | null => {
  const start = node.position?.start.offset
  const end = node.position?.end.offset
  return typeof start === 'number' && typeof end === 'number' ? { start, end } : null
}

export const walkMarkdown = (
  node: MarkdownNode,
  visit: (
    node: MarkdownNode,
    parent: MarkdownNode | null,
    ancestors: readonly MarkdownNode[]
  ) => boolean | void,
  parent: MarkdownNode | null = null,
  ancestors: readonly MarkdownNode[] = []
): void => {
  if (visit(node, parent, ancestors) === false) return
  for (const child of node.children ?? []) {
    walkMarkdown(child, visit, node, [...ancestors, node])
  }
}
