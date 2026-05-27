import { createElement, useMemo } from 'react'
import {
  ContentDocumentRenderer,
  createReactContentRuntime,
  type ReactContentPlugin,
  type RuntimeExecutionPolicy
} from '@tinytinkerer/content-react'
import { parseMarkdownContent } from './parse-markdown-content'

export type MarkdownContentProps = {
  content: string
  className?: string
  isStreaming?: boolean
  plugins?: readonly ReactContentPlugin[]
  executionPolicy?: RuntimeExecutionPolicy
}

export const MarkdownContent = ({
  content,
  className,
  isStreaming = false,
  plugins,
  executionPolicy
}: MarkdownContentProps) => {
  const document = useMemo(() => parseMarkdownContent(content), [content])
  const runtime = useMemo(() => {
    const built = createReactContentRuntime(
      executionPolicy ? { executionPolicy } : undefined
    )
    if (plugins) {
      for (const plugin of plugins) {
        built.register(plugin)
      }
    }
    return built
  }, [executionPolicy, plugins])

  return createElement(ContentDocumentRenderer, {
    document,
    isStreaming,
    runtime,
    ...(className ? { className } : {})
  })
}
