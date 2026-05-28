import type { ContentDocument } from '@tinytinkerer/contracts'
import {
  CodeBlockFallback,
  ContentDocumentContent,
  type CodeBlockNode,
  type ContentRenderOptions,
  type RenderContext,
  type ReactNodeRendererPlugin
} from '@tinytinkerer/content-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { calloutPlugin } from '@tinytinkerer/content-callout'
import { imagePlugin } from '@tinytinkerer/content-image'
import { linkCardPlugin } from '@tinytinkerer/content-link-card'
import { tablePlugin } from '@tinytinkerer/content-table'
import { useOptionalBrowserApp } from './app'

export type AssistantContentProps = {
  content: ContentDocument
  isStreaming?: boolean
  className?: string
  turnId?: string
}

const createLazyCodeBlockPlugin = (options: {
  id: string
  priority: number
  requirements: NonNullable<ReactNodeRendererPlugin<'codeBlock'>['requirements']>
  matches: (node: CodeBlockNode) => boolean
  loadPlugin: () => Promise<ReactNodeRendererPlugin<'codeBlock'>>
}): ReactNodeRendererPlugin<'codeBlock'> => {
  let plugin: ReactNodeRendererPlugin<'codeBlock'> | null = null
  let pluginPromise: Promise<ReactNodeRendererPlugin<'codeBlock'>> | null = null

  const renderFallback = (node: CodeBlockNode): ReactNode => (
    <CodeBlockFallback
      code={node.code}
      {...(node.language ? { language: node.language } : {})}
    />
  )

  const ensurePlugin = async (): Promise<ReactNodeRendererPlugin<'codeBlock'>> => {
    if (plugin) {
      return plugin
    }

    pluginPromise ??= options
      .loadPlugin()
      .then(async (loadedPlugin) => {
        await loadedPlugin.load?.()
        plugin = loadedPlugin
        return loadedPlugin
      })
      .catch((error: unknown) => {
        pluginPromise = null
        throw error
      })

    return pluginPromise
  }

  const LazyCodeBlockRenderer = ({
    node,
    ctx
  }: {
    node: CodeBlockNode
    ctx: RenderContext<ReactNode>
  }) => {
    const [failed, setFailed] = useState(false)
    const [, setRevision] = useState(0)

    useEffect(() => {
      if (plugin || failed) {
        return
      }

      let cancelled = false
      void ensurePlugin()
        .then(() => {
          if (!cancelled) {
            setRevision((value) => value + 1)
          }
        })
        .catch(() => {
          if (!cancelled) {
            setFailed(true)
            setRevision((value) => value + 1)
          }
        })

      return () => {
        cancelled = true
      }
    }, [failed])

    if (!plugin) {
      return renderFallback(node)
    }

    return plugin.render(node, ctx)
  }

  return {
    id: options.id,
    nodeType: 'codeBlock',
    priority: options.priority,
    requirements: options.requirements,
    matches: options.matches,
    render: (node, ctx) =>
      <LazyCodeBlockRenderer node={node} ctx={ctx} />,
    fallback: (node, failure) =>
      plugin?.fallback
        ? plugin.fallback(node, failure)
        : renderFallback(node)
  }
}

const codePlugin = createLazyCodeBlockPlugin({
  id: 'code',
  priority: 30,
  requirements: { clientOnly: true },
  matches: () => true,
  loadPlugin: () => import('@tinytinkerer/content-code').then((module) => module.codePlugin)
})

const mermaidPlugin = createLazyCodeBlockPlugin({
  id: 'mermaid',
  priority: 50,
  requirements: { clientOnly: true, needsDom: true },
  matches: (node) => node.language === 'mermaid',
  loadPlugin: () => import('@tinytinkerer/content-mermaid').then((module) => module.mermaidPlugin)
})

const wireframePlugin = createLazyCodeBlockPlugin({
  id: 'wireframe',
  priority: 40,
  requirements: { clientOnly: true, needsDom: true },
  matches: (node) => node.language === 'wireframe',
  loadPlugin: () => import('@tinytinkerer/content-wireframe').then((module) => module.wireframePlugin)
})

const assistantPlugins = [
  mermaidPlugin,
  wireframePlugin,
  codePlugin,
  calloutPlugin,
  linkCardPlugin,
  imagePlugin,
  tablePlugin
]

const useShowCodeBlockFullscreenButton = (): boolean => {
  const app = useOptionalBrowserApp()
  const [value, setValue] = useState<boolean>(
    () => app?.stores.settings.getState().showCodeBlockFullscreenButton ?? true
  )
  useEffect(() => {
    if (!app) return
    const store = app.stores.settings
    setValue(store.getState().showCodeBlockFullscreenButton)
    return store.subscribe((state) => {
      setValue(state.showCodeBlockFullscreenButton)
    })
  }, [app])
  return value
}

export const AssistantContent = ({
  content,
  isStreaming = false,
  className,
  turnId
}: AssistantContentProps) => {
  const showCodeBlockFullscreenButton = useShowCodeBlockFullscreenButton()
  const renderOptions = useMemo<ContentRenderOptions>(
    () => ({
      ...(turnId ? { codeBlockPersistenceScopeId: turnId } : {}),
      showCodeBlockFullscreenButton
    }),
    [turnId, showCodeBlockFullscreenButton]
  )

  return (
    <ContentDocumentContent
      document={content}
      isStreaming={isStreaming}
      plugins={assistantPlugins}
      renderOptions={renderOptions}
      {...(className ? { className } : {})}
    />
  )
}
