/**
 * The criterion #477 deferred to #479: the three documentation tools are visible
 * in the NORMAL tool picker of the assistant session, independently controllable
 * there, and absent from a live lab's picker.
 *
 * Driven through the render the widget actually performs — a bare
 * `<ToolTreeSlot />`, exactly as `FloatingChatSurface` renders it, with no
 * options — rather than through `useToolTree({ fallbackSummarizer })`.
 *
 * That distinction is the whole point of this file now. The first revision
 * called the hook WITH a fallback and described it as "what the assistant does";
 * nothing did. `ToolTreeSlot` renders `null` without a summarizer, docs plugin
 * discovery resolves to `[]`, and so the real widget shipped with no tool picker
 * at all while this test passed (issue #480 review, finding 1). A test that
 * supplies the missing piece itself cannot detect the missing piece.
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { ReactNode } from 'react'
import {
  AppBrowserProvider,
  createBrowserApp,
  genericToolTreeSummarizer,
  ToolTreeSlot,
  type BrowserApp
} from '@tinytinkerer/app-browser'
import {
  createDocumentationToolGroup,
  DOCUMENTATION_TOOL_GROUP_ID,
  READ_CURRENT_DOC_TOOL_ID,
  READ_DOC_TOOL_ID,
  SEARCH_DOCS_TOOL_ID
} from '../../docs-tools'
import { loadPlugins } from '@tinytinkerer/catalogue'
import { pluginToolPickerDemoToolGroup } from '../../live-lab/plugin-tool-picker/demo-tools'
import { DOCS_ASSISTANT_PLUGINS } from '../plugin-catalogue'

// Most cases here are about the picker itself rather than the catalogue, so their
// apps carry no plugins (issue #495 makes `plugins` a required, undefaulted
// option). The last suite in this file is the exception, and uses the real one.
const noPlugins = () => Promise.resolve([])

const renderSlot = (app: BrowserApp) =>
  render(<ToolTreeSlot />, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <AppBrowserProvider app={app}>{children}</AppBrowserProvider>
    )
  })

/**
 * Built with the options `createDocsBrowserApp` produces for a docs app that has
 * a tool group — see create-docs-app.test.ts, which pins that the factory really
 * supplies them, so these two together cover the production path without needing
 * the IndexedDB the factory itself opens.
 */
const docsApp = (appToolGroup: BrowserApp['appToolGroup']): BrowserApp => {
  const app = createBrowserApp(
    { storageNamespace: 'tinytinkerer-docs-picker-test' },
    appToolGroup
      ? { plugins: noPlugins, appToolGroup, toolTreeSummarizer: genericToolTreeSummarizer }
      : { plugins: noPlugins }
  )
  // Toggling a tool persists the denylist through Dexie, which needs an
  // IndexedDB this environment does not have. Only the STORAGE is stood in for —
  // the click, the store action and the normalization it performs are all real,
  // which is what the previous revision skipped by writing state directly.
  const preferences = new Map<string, string>()
  Object.assign(app.shell, {
    preferences: {
      get: (key: string) => Promise.resolve(preferences.get(key)),
      set: (key: string, value: string) => {
        preferences.set(key, value)
        return Promise.resolve()
      }
    }
  })
  return app
}

const assistantApp = (): BrowserApp => docsApp(createDocumentationToolGroup())
const labApp = (): BrowserApp => docsApp(pluginToolPickerDemoToolGroup)

const openPicker = async (): Promise<void> => {
  await userEvent.click(screen.getByRole('button', { name: 'Choose available tools' }))
  await waitFor(() => {
    expect(screen.getByRole('dialog', { name: 'Choose available tools' })).toBeInTheDocument()
  })
}

describe('the assistant tool picker', () => {
  it('offers the picker button from the widget"s own bare slot', async () => {
    renderSlot(assistantApp())

    // The render `FloatingChatSurface` performs. This is the assertion the
    // preview disproved: count 0, because nothing supplied a summarizer.
    expect(screen.getByRole('button', { name: 'Choose available tools' })).toBeInTheDocument()
    expect(screen.getByTestId('tool-tree-toggle')).toBeInTheDocument()
    await openPicker()
  })

  it('lists the Documentation group with all three tools enabled', async () => {
    renderSlot(assistantApp())
    await openPicker()

    const dialog = screen.getByRole('dialog', { name: 'Choose available tools' })
    expect(dialog).toHaveTextContent('Documentation')
    for (const toolId of [SEARCH_DOCS_TOOL_ID, READ_DOC_TOOL_ID, READ_CURRENT_DOC_TOOL_ID]) {
      // Enabled by default: a reader who never opens the picker still gets them.
      expect(screen.getByRole('checkbox', { name: new RegExp(toolId) })).toBeChecked()
    }
  })

  it('disables one documentation tool without touching the other two', async () => {
    const app = assistantApp()
    renderSlot(app)
    await openPicker()

    await userEvent.click(screen.getByRole('checkbox', { name: new RegExp(SEARCH_DOCS_TOOL_ID) }))

    await waitFor(() => {
      expect(
        app.stores.settings.getState().appToolDisablement[DOCUMENTATION_TOOL_GROUP_ID]
      ).toEqual([SEARCH_DOCS_TOOL_ID])
    })
    expect(screen.getByRole('checkbox', { name: new RegExp(READ_DOC_TOOL_ID) })).toBeChecked()
    expect(
      screen.getByRole('checkbox', { name: new RegExp(READ_CURRENT_DOC_TOOL_ID) })
    ).toBeChecked()
  })

  it('re-enables it again from the same picker', async () => {
    const app = assistantApp()
    renderSlot(app)
    await openPicker()

    const checkbox = () => screen.getByRole('checkbox', { name: new RegExp(SEARCH_DOCS_TOOL_ID) })
    await userEvent.click(checkbox())
    await waitFor(() => {
      expect(checkbox()).not.toBeChecked()
    })

    await userEvent.click(checkbox())
    await waitFor(() => {
      expect(checkbox()).toBeChecked()
    })
    // Re-enabling the last disabled tool drops the group's denylist entry rather
    // than storing an empty one.
    expect(
      app.stores.settings.getState().appToolDisablement[DOCUMENTATION_TOOL_GROUP_ID] ?? []
    ).toEqual([])
  })

  it('shows a live lab"s own group instead, never the Documentation one', async () => {
    renderSlot(labApp())
    await openPicker()

    const dialog = screen.getByRole('dialog', { name: 'Choose available tools' })
    expect(dialog).not.toHaveTextContent('Documentation')
    expect(dialog).toHaveTextContent(pluginToolPickerDemoToolGroup.label)
  })

  it('renders nothing at all without the app"s summarizer — the defect this pins', () => {
    // The state the widget actually shipped in: a real `appToolGroup`, a real
    // slot, and no picker, because no plugin can contribute a mapper in a docs
    // build. Kept as a test so the fallback cannot be quietly dropped again.
    const withoutSummarizer = createBrowserApp(
      { storageNamespace: 'tinytinkerer-docs-picker-test' },
      { plugins: noPlugins, appToolGroup: createDocumentationToolGroup() }
    )
    const { container } = renderSlot(withoutSummarizer)

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByRole('button', { name: 'Choose available tools' })).toBeNull()
  })

  it('keeps the picker when a reader enables the tool-tree plugin', async () => {
    // The one behaviour change #495 makes to a surface that already ships.
    //
    // `useToolTree` resolves its summarizer from the first ENABLED plugin
    // carrying a `toolTreeDescriptor`, falling back to `app.toolTreeSummarizer`.
    // Before #495 the docs catalogue was empty, so the fallback was the only
    // possibility and the branch above it was dead here. Both documentation
    // catalogues now carry `plugin-tool-tree`, so a reader switching it on in
    // Settings moves the assistant's picker onto the PLUGIN's mapper — a live
    // path with no coverage until now.
    //
    // The real catalogue, not a stub: this asserts what a reader of the shipped
    // site gets, and `apps/docs` may import `@tinytinkerer/catalogue` (see
    // scripts/check-boundaries.mjs).
    //
    // Built WITHOUT `toolTreeSummarizer`, deliberately. With both present this
    // test could not tell which one rendered the picker — the two mappers are
    // deliberate twins (see `genericToolTreeSummarizer`'s header), so a passing
    // assertion would prove nothing about the plugin branch. Removing the
    // fallback makes the plugin the ONLY thing that can produce a picker here,
    // which is exactly the case the test above (`renders nothing at all without
    // the app's summarizer`) shows is otherwise empty.
    const app = createBrowserApp(
      { storageNamespace: 'tinytinkerer-docs-picker-test' },
      {
        plugins: () => loadPlugins(DOCS_ASSISTANT_PLUGINS),
        appToolGroup: createDocumentationToolGroup()
      }
    )
    const preferences = new Map<string, string>()
    Object.assign(app.shell, {
      preferences: {
        get: (key: string) => Promise.resolve(preferences.get(key)),
        set: (key: string, value: string) => {
          preferences.set(key, value)
          return Promise.resolve()
        }
      }
    })
    app.stores.settings.setState({ pluginActivation: { 'tool-tree': true } })

    renderSlot(app)

    const toggle = await screen.findByRole('button', { name: 'Choose available tools' })
    await userEvent.click(toggle)

    const dialog = screen.getByRole('dialog', { name: 'Choose available tools' })
    await waitFor(() => expect(dialog).toHaveTextContent('Documentation'))
    for (const toolId of [SEARCH_DOCS_TOOL_ID, READ_DOC_TOOL_ID, READ_CURRENT_DOC_TOOL_ID]) {
      expect(dialog.querySelector(`[data-testid="tool-tree-tool-${toolId}"]`)).not.toBeNull()
    }

    // …and the plugin contributes no TOOLS of its own, so enabling it must not
    // add a second group to the reader's picker.
    expect(dialog).not.toHaveTextContent('Tool picker (tree view)')
  })
})
