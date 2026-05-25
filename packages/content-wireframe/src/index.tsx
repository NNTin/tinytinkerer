import type { WireframeNode } from '@tinytinkerer/content-core'
import { CodeBlockFallback, type ContentNodeRendererProps } from '@tinytinkerer/content-react'

export const WireframeNodeRenderer = ({ node }: ContentNodeRendererProps<WireframeNode>) => {
  if (!node.code.trim()) {
    return <CodeBlockFallback code={node.code} language="wireframe" />
  }

  return (
    <div
      data-tt-wireframe=""
      className="overflow-hidden rounded-lg border border-stone-200 bg-stone-50"
    >
      <div className="flex items-center gap-1 border-b border-stone-200 bg-white px-3 py-2">
        <span className="h-2.5 w-2.5 rounded-full bg-stone-300" />
        <span className="h-2.5 w-2.5 rounded-full bg-stone-300" />
        <span className="h-2.5 w-2.5 rounded-full bg-stone-300" />
        <span className="ml-2 text-[11px] font-medium uppercase tracking-wide text-stone-500">Wireframe</span>
      </div>
      <iframe
        srcDoc={node.code}
        title="Wireframe preview"
        sandbox="allow-same-origin allow-scripts"
        className="h-64 w-full border-0 bg-white"
      />
    </div>
  )
}
