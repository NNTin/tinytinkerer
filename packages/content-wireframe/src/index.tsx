import {
  CodeBlockFallback,
  PreviewCodeFrame,
  type CodeBlockNode,
  type ContentNodeRendererProps,
  type ReactNodeRendererPlugin,
} from '@tinytinkerer/content-react'

export const WireframeNodeRenderer = ({ node }: ContentNodeRendererProps<CodeBlockNode>) => {
  if (!node.code.trim()) {
    return <CodeBlockFallback code={node.code} language={node.language ?? 'wireframe'} />
  }

  return (
    <PreviewCodeFrame
      containerProps={{ 'data-tt-wireframe': '' }}
      headerStart={
        <div className="flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-full bg-stone-300" />
          <span className="h-2.5 w-2.5 rounded-full bg-stone-300" />
          <span className="h-2.5 w-2.5 rounded-full bg-stone-300" />
          <span className="ml-2 text-[11px] font-medium uppercase tracking-wide text-stone-500">Wireframe</span>
        </div>
      }
      code={node.code}
      codeLanguage="html"
      preview={
        <iframe
          srcDoc={node.code}
          title="Wireframe preview"
          sandbox="allow-scripts"
          className="h-64 w-full border-0 bg-white"
        />
      }
    />
  )
}

export const createWireframePlugin = (): ReactNodeRendererPlugin<'codeBlock'> => ({
  id: 'wireframe',
  nodeType: 'codeBlock',
  priority: 40,
  capabilities: { preview: true },
  requirements: { clientOnly: true, needsDom: true },
  matches: (node) => node.language === 'wireframe',
  render: (node) => <WireframeNodeRenderer node={node} />,
  fallback: (node) => <CodeBlockFallback code={node.code} language={node.language ?? 'wireframe'} />
})

export const wireframePlugin: ReactNodeRendererPlugin<'codeBlock'> = createWireframePlugin()
