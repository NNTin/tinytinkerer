import { createElement, useMemo } from 'react'
import {
  ContentDocumentRenderer,
  createReactContentRuntime,
  type ContentDocument,
  type ReactContentPlugin,
  type RuntimeExecutionPolicy
} from '@tinytinkerer/content-react'

export type ContentDocumentContentProps = {
  document: ContentDocument
  className?: string
  isStreaming?: boolean
  plugins?: readonly ReactContentPlugin[]
  executionPolicy?: RuntimeExecutionPolicy
}

export const ContentDocumentContent = ({
  document,
  className,
  isStreaming = false,
  plugins,
  executionPolicy
}: ContentDocumentContentProps) => {
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
