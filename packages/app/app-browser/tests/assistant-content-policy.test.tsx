// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { Turn } from '@tinytinkerer/app-core'
import { parseMarkdownContent } from '@tinytinkerer/content-markdown'
import { AppBrowserProvider, type BrowserApp } from '../src/app.js'
import type { AppAssistantPolicy, AppToolResultRecord } from '../src/app-assistant-policy.js'
import { AssistantContent } from '../src/assistant-content.js'
import { toolResultsFromActivity } from '../src/assistant-content-policy.js'
import { TurnChrome } from '../src/turn-chrome.js'

// The render-time half of issue #478: an app can rewrite every rendered
// snapshot, and the transcript hands it the turn's own successful tool results.
// What the documentation assistant does with them is tested in apps/docs.

afterEach(cleanup)

// The smallest BrowserApp the transcript actually reads: the policy, plus the
// two stores AssistantContent consults (the code-block affordance and the media
// registry).
// Snapshots must be reference-stable: both hooks read them through
// `useSyncExternalStore`, which re-renders forever on a fresh object each call.
const SETTINGS_STATE = { showCodeBlockFullscreenButton: true }
const CHAT_STATE = { events: [] }
const unsubscribed = () => () => undefined

const appWith = (policy: AppAssistantPolicy): BrowserApp =>
  ({
    appAssistantPolicy: policy,
    stores: {
      settings: { subscribe: unsubscribed, getState: () => SETTINGS_STATE },
      chat: { subscribe: unsubscribed, getState: () => CHAT_STATE }
    }
  }) as unknown as BrowserApp

/** Drops every link, so "the policy ran" is visible in the rendered output. */
const dropLinks: AppAssistantPolicy = {
  prepareRenderedContent: () => (document) => ({
    nodes: document.nodes.map((node) =>
      node.type === 'paragraph'
        ? {
            ...node,
            children: node.children.map((child) =>
              child.type === 'link' ? { type: 'text' as const, value: 'redacted' } : child
            )
          }
        : node
    )
  })
}

const turn = (activity: Turn['activity']['items']): Turn => ({
  id: 'turn-1',
  userText: 'a question',
  assistantSource: 'see [it](/docs/x/)',
  assistantContent: parseMarkdownContent('see [it](/docs/x/)'),
  isStreaming: false,
  activity: { items: activity, reasoningText: '' }
})

describe('the rendered-content policy', () => {
  it('is applied to the content the transcript mounts', () => {
    render(
      <AppBrowserProvider app={appWith(dropLinks)}>
        <AssistantContent content={parseMarkdownContent('see [it](/docs/x/)')} />
      </AppBrowserProvider>
    )

    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByText(/redacted/)).toBeInTheDocument()
  })

  it('leaves content alone for an app with no policy', () => {
    render(<AssistantContent content={parseMarkdownContent('see [it](/docs/x/)')} />)
    expect(screen.getByRole('link')).toHaveAttribute('href', '/docs/x/')
  })

  it("receives the turn's own successful tool results, provenance included", () => {
    const seen: AppToolResultRecord[][] = []
    const app = appWith({
      prepareRenderedContent: ({ results }) => {
        seen.push([...results])
        return (document) => document
      }
    })

    render(
      <AppBrowserProvider app={app}>
        <TurnChrome
          turn={turn([
            {
              kind: 'tool',
              id: '1',
              toolId: 'read_doc',
              status: 'completed',
              output: { ok: 1 },
              source: { kind: 'app', groupId: 'documentation' }
            },
            { kind: 'tool', id: '2', toolId: 'search_docs', status: 'failed', error: 'boom' },
            { kind: 'tool', id: '3', toolId: 'read_doc', status: 'started', input: {} },
            { kind: 'reasoning', id: '4', text: 'thinking' }
          ])}
          isLive={false}
          serverNameById={new Map()}
        />
      </AppBrowserProvider>
    )

    // Only the completed call, no `input` alongside it, and the host's own
    // attribution — which is what a trust-gating policy reads after a reload.
    expect(seen.at(-1)).toEqual([
      { toolId: 'read_doc', output: { ok: 1 }, source: { kind: 'app', groupId: 'documentation' } }
    ])
  })

  it('compiles the sanitizer once per results change, not once per chunk', () => {
    // The cost this guards is real: the documentation policy validates every
    // read (up to 20,000 characters of Markdown) against its schema and rebuilds
    // its target sets inside `prepareRenderedContent`. Doing that per streamed
    // delta would scale with result-size x chunks.
    let prepared = 0
    let sanitized = 0
    const app = appWith({
      prepareRenderedContent: () => {
        prepared += 1
        return (document) => {
          sanitized += 1
          return document
        }
      }
    })
    const results: AppToolResultRecord[] = [{ toolId: 'read_doc', output: { ok: 1 } }]

    const view = render(
      <AppBrowserProvider app={app}>
        <AssistantContent content={parseMarkdownContent('one')} toolResults={results} />
      </AppBrowserProvider>
    )
    for (const chunk of ['two', 'three', 'four', 'five']) {
      view.rerender(
        <AppBrowserProvider app={app}>
          <AssistantContent content={parseMarkdownContent(chunk)} toolResults={results} />
        </AppBrowserProvider>
      )
    }

    expect(prepared).toBe(1)
    expect(sanitized).toBe(5)
  })

  it('recompiles when a new tool result lands', () => {
    let prepared = 0
    const app = appWith({
      prepareRenderedContent: () => {
        prepared += 1
        return (document) => document
      }
    })
    const content = parseMarkdownContent('answer')

    const view = render(
      <AppBrowserProvider app={app}>
        <AssistantContent content={content} toolResults={[{ toolId: 'a', output: 1 }]} />
      </AppBrowserProvider>
    )
    view.rerender(
      <AppBrowserProvider app={app}>
        <AssistantContent
          content={content}
          toolResults={[
            { toolId: 'a', output: 1 },
            { toolId: 'b', output: 2 }
          ]}
        />
      </AppBrowserProvider>
    )

    expect(prepared).toBe(2)
  })
})

describe('toolResultsFromActivity', () => {
  it('keeps completed tool calls in order and drops everything else', () => {
    expect(
      toolResultsFromActivity([
        { kind: 'label', id: 'a', label: 'Thinking' },
        { kind: 'tool', id: 'b', toolId: 'first', status: 'completed', output: 1 },
        { kind: 'tool', id: 'c', toolId: 'second', status: 'failed', error: 'no' },
        { kind: 'tool', id: 'd', toolId: 'third', status: 'completed', output: 3 }
      ])
    ).toEqual([
      { toolId: 'first', output: 1 },
      { toolId: 'third', output: 3 }
    ])
  })

  it('is stable enough for a settled turn to keep its memoized render', () => {
    const items: Parameters<typeof toolResultsFromActivity>[0] = [
      { kind: 'tool', id: 'b', toolId: 'first', status: 'completed', output: 1 }
    ]
    // Not reference-equal (a fresh array each call), which is why TurnChrome
    // memoizes on `turn.activity.items` rather than on the derived list.
    expect(toolResultsFromActivity(items)).not.toBe(toolResultsFromActivity(items))
    expect(toolResultsFromActivity(items)).toEqual(toolResultsFromActivity(items))
  })
})
