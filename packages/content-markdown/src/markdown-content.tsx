import { createElement, useMemo } from 'react'
import {
  ContentDocumentRenderer,
  createReactContentRuntime,
  type ReactContentPlugin
} from '@tinytinkerer/content-react'
import { parseMarkdownContent } from './parse-markdown-content'

export type MarkdownContentProps = {
  content: string
  className?: string
  isStreaming?: boolean
  plugins?: readonly ReactContentPlugin[]
}

export const MarkdownContent = ({
  content,
  className,
  isStreaming = false,
  plugins
}: MarkdownContentProps) => {
  const document = useMemo(() => parseMarkdownContent(content), [content])
  const runtime = useMemo(() => {
    const built = createReactContentRuntime()
    if (plugins) {
      for (const plugin of plugins) {
        built.register(plugin)
      }
    }
    return built
  }, [plugins])

  return createElement(ContentDocumentRenderer, {
    document,
    isStreaming,
    runtime,
    ...(className ? { className } : {})
  })
}
