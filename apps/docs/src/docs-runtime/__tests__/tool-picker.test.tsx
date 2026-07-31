/**
 * The criterion #477 deferred to this issue: the three documentation tools are
 * visible in the NORMAL tool picker of the assistant session, independently
 * controllable there, and absent from a live lab's picker.
 *
 * Driven through the genuine host path — a real `BrowserApp` built the way
 * `assistant-app.ts` builds it, a real `AppBrowserProvider`, and app-browser's
 * own `useToolTree` — rather than a stand-in, because the thing under test is
 * exactly the wiring between them. See
 * https://github.com/NNTin/tinytinkerer/issues/477#issuecomment-5135508327
 * (item 0).
 */
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { ReactNode } from 'react'
import {
  AppBrowserProvider,
  createBrowserApp,
  genericToolTreeSummarizer,
  useToolTree,
  type BrowserApp
} from '@tinytinkerer/app-browser'
import {
  createDocumentationToolGroup,
  DOCUMENTATION_TOOL_GROUP_ID,
  READ_CURRENT_DOC_TOOL_ID,
  READ_DOC_TOOL_ID,
  SEARCH_DOCS_TOOL_ID
} from '../../docs-tools'
import { pluginToolPickerDemoToolGroup } from '../../live-lab/plugin-tool-picker/demo-tools'

// The docs build discovers no plugins (see live-lab/plugin-registry-stub.ts), so
// a docs picker has nothing to render a tree from unless the host supplies the
// package's own product-agnostic mapper — which is what the assistant does.
const renderPicker = (app: BrowserApp) =>
  renderHook(() => useToolTree({ fallbackSummarizer: genericToolTreeSummarizer }), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <AppBrowserProvider app={app}>{children}</AppBrowserProvider>
    )
  })

const assistantApp = (): BrowserApp =>
  createBrowserApp(
    { storageNamespace: 'tinytinkerer-docs-assistant-test' },
    { appToolGroup: createDocumentationToolGroup() }
  )

const labApp = (): BrowserApp =>
  createBrowserApp(
    { storageNamespace: 'tinytinkerer-docs-lab-test' },
    { appToolGroup: pluginToolPickerDemoToolGroup }
  )

describe('the assistant tool picker', () => {
  it('lists the Documentation group with all three tools enabled', () => {
    const { result } = renderPicker(assistantApp())

    const group = result.current.input.plugins.find(
      (entry) => entry.id === DOCUMENTATION_TOOL_GROUP_ID
    )
    expect(group).toBeDefined()
    expect(group?.label).toBe('Documentation')
    expect(group?.tools.map((entry) => entry.id).sort()).toEqual(
      [READ_CURRENT_DOC_TOOL_ID, READ_DOC_TOOL_ID, SEARCH_DOCS_TOOL_ID].sort()
    )
    // Enabled by default: a reader who never opens the picker still gets them.
    expect(group?.tools.every((entry) => entry.enabled)).toBe(true)
    // It is an APP group, so it has no activation toggle of its own and stays
    // visible even with every tool unchecked.
    expect(result.current.appGroupIds).toContain(DOCUMENTATION_TOOL_GROUP_ID)
  })

  it('disables one documentation tool without touching the other two', () => {
    const app = assistantApp()
    const { result } = renderPicker(app)

    // The disablement state is set directly rather than through
    // `setAppToolSelection`, whose persistence step needs an IndexedDB this
    // environment does not have. What belongs to #479 is the derivation — that
    // a per-tool disablement reaches this group's own picker entry and no
    // other; persisting it is app-browser's own concern and is covered by its
    // settings-store suite.
    act(() => {
      app.stores.settings.setState({
        appToolDisablement: { [DOCUMENTATION_TOOL_GROUP_ID]: [SEARCH_DOCS_TOOL_ID] }
      })
    })

    const byId = Object.fromEntries(
      (
        result.current.input.plugins.find((entry) => entry.id === DOCUMENTATION_TOOL_GROUP_ID)
          ?.tools ?? []
      ).map((entry) => [entry.id, entry.enabled])
    )
    expect(byId[SEARCH_DOCS_TOOL_ID]).toBe(false)
    expect(byId[READ_DOC_TOOL_ID]).toBe(true)
    expect(byId[READ_CURRENT_DOC_TOOL_ID]).toBe(true)
  })

  it('does not appear in a live lab session, which carries its own group', () => {
    const { result } = renderPicker(labApp())

    const ids = result.current.input.plugins.map((entry) => entry.id)
    expect(ids).not.toContain(DOCUMENTATION_TOOL_GROUP_ID)
    expect(ids).toContain(pluginToolPickerDemoToolGroup.id)
  })
})
