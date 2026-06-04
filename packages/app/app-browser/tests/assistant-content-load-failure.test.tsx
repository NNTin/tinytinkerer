// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseMarkdownContent } from '@tinytinkerer/content-markdown'
import {
  setContentRenderErrorReporter,
  type ContentRenderErrorInfo
} from '@tinytinkerer/content-react'

// Force the lazy code-block plugin chunk to fail to load: accessing `codePlugin`
// throws, which rejects the dynamic import inside the lazy renderer.
vi.mock('@tinytinkerer/content-code', () => ({
  get codePlugin() {
    throw new Error('chunk load failed')
  }
}))

import { AssistantContent } from '../src/assistant-content.js'

describe('AssistantContent lazy plugin load failures', () => {
  const reported: Array<{ error: Error; info: ContentRenderErrorInfo }> = []

  beforeEach(() => {
    reported.length = 0
    setContentRenderErrorReporter((error, info) => {
      reported.push({ error, info })
    })
  })

  afterEach(() => {
    cleanup()
    setContentRenderErrorReporter(null)
  })

  it('reports loadFailed when the code-block plugin chunk fails to load, then renders the fallback', async () => {
    render(
      <AssistantContent content={parseMarkdownContent(['```js', 'const x = 1', '```'].join('\n'))} />
    )

    await waitFor(() => {
      expect(reported.some((entry) => entry.info.reason === 'loadFailed')).toBe(true)
    })

    const loadFailure = reported.find((entry) => entry.info.reason === 'loadFailed')
    expect(loadFailure?.info.pluginId).toBe('code')
    expect(loadFailure?.info.nodeType).toBe('codeBlock')
    // The plain-code fallback still renders rather than the render crashing.
    expect(document.querySelector('pre code')).not.toBeNull()
  })
})
