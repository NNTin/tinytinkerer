import { test, expect, type Page } from '@playwright/test'
import {
  installChatMock,
  installLiteLLMMock,
  enableToolTreePlugin,
  enableCodeExecPlugin,
  enableBrowserStatePlugin,
  runSnippetViaChat,
  type LiteLLMMock
} from '../fixtures/mock-litellm'
import { dismissFirstLoad } from '../fixtures/first-load'

// Real-browser verification of the Tool tree plugin's compose-area tool picker
// (GitHub issue #400). The plugin contributes NO tools of its own — only a button
// that opens every ENABLED plugin's declared tools as a checkbox tree — so the
// thing actually under test is the host-owned policy chokepoint the panel drives
// (`applyPluginToolSelection` / `isPluginToolEnabled`, see
// packages/app/app-core/src/settings.ts): unchecking a tool persists a denylist
// that a NEWLY BUILT runtime excludes from what it registers AND advertises to the
// model, and unchecking a plugin's last tool disables that plugin outright. A jsdom
// unit test (tool-tree.test.tsx) already covers the store/panel wiring against a
// fake settings store; this spec proves the same rule holds for a REAL runtime
// build talking to a REAL (mocked) LiteLLM — the tools array the model actually
// sees, not just the panel's own state.
//
// Two tool-contributing plugins are enabled alongside the tree: code-exec
// (run_javascript) and browser-state (read_dom — its ONLY tool, chosen
// deliberately so unchecking it in one motion also exercises the "last tool
// unchecked disables the plugin" rule, without a second plugin needed for that).
//
// To observe the ACTUAL advertised tools we need a real ReAct decide call, which
// only a tool-driving mock issues predictably (see native-tool-calls.e2e.ts): the
// react.decide request always carries a `tools` array (issue #276), so this spec
// mirrors that suite's `installLiteLLMMock` + `runSnippetViaChat` setup rather than
// the plain no-tool chat mock. Settings changes only take effect on the NEXT
// runtime build, so all tree interaction happens BEFORE the prompt is sent. Only
// LiteLLM is mocked; the run is anonymous through the real edge worker. See
// packages/e2e/README.md.

const TOGGLE = '[data-testid="tool-tree-toggle"]'
const PANEL = '[data-testid="tool-tree-panel"]'
const CODE_EXEC_LABEL = 'Code execution (run_javascript tool)'
const BROWSER_STATE_LABEL = 'Browser state (read_dom tool)'

const pluginRow = (pluginId: string): string => `[data-testid="tool-tree-plugin-${pluginId}"]`
const toolRow = (toolId: string): string => `[data-testid="tool-tree-tool-${toolId}"]`

// A trivial deterministic snippet — its actual behavior is irrelevant here; only
// that run_javascript executes for real and its result folds back into a follow-up
// request (giving us a request to inspect the advertised `tools` on).
const SNIPPET = 'return 1 + 1'

type ForwardedBody = {
  messages: Array<{ role: string }>
  tools?: Array<{ type: string; function: { name: string } }>
}

// Mirrors native-tool-calls.e2e.ts's forwardedChatBodies: only chat-completion
// bodies carry a `messages` array (key-management bodies don't).
const forwardedChatBodies = (mock: LiteLLMMock): ForwardedBody[] =>
  mock
    .requestBodies()
    .map((raw) => JSON.parse(raw) as ForwardedBody)
    .filter((body) => Array.isArray(body.messages))

// Reads (without changing) a plugin's Settings toggle state — the ground truth for
// "is this plugin enabled". Mirrors mock-litellm.ts's internal
// `openSettingsAndEnablePlugin`: open Settings if not already open, then hunt
// across tabs for whichever one renders the plugin's label (plugins live under
// different tabs), since only the active tab's panel is mounted. Unlike that
// helper this never clicks the label — it only asserts the checkbox's current
// `checked` state, so it is safe to call on a plugin that is expected to be OFF.
const readPluginToggleChecked = async (page: Page, label: string): Promise<boolean> => {
  const settingsDialog = page.getByRole('dialog', { name: 'Settings' })
  if (!(await settingsDialog.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'Settings' }).click()
    await expect(settingsDialog).toBeVisible()
  }

  const labelText = page.getByText(label)
  if (!(await labelText.isVisible().catch(() => false))) {
    const tabs = settingsDialog.getByRole('tab')
    const tabCount = await tabs.count()
    for (let index = 0; index < tabCount; index += 1) {
      await tabs.nth(index).click()
      if (await labelText.isVisible().catch(() => false)) {
        break
      }
    }
  }
  await labelText.scrollIntoViewIfNeeded()
  return page.getByRole('checkbox', { name: label }).isChecked()
}

test.describe('tool tree plugin: compose-area tool picker (#400)', () => {
  test('button gating: the picker is absent until the tool-tree plugin itself is enabled', async ({
    page
  }) => {
    await installChatMock(page)
    await page.goto('/web/')
    await dismissFirstLoad(page)

    // No tool-tree plugin enabled at all: no button.
    await expect(page.locator(TOGGLE)).toHaveCount(0)

    // A tool-contributing plugin being enabled is NOT enough on its own — the
    // picker only appears once the tool-tree plugin itself is on (its manifest
    // carries the toolTreeDescriptor the host resolves the button from).
    await enableCodeExecPlugin(page)
    await expect(page.locator(TOGGLE)).toHaveCount(0)
  })

  test("uncheck a tool: excluded from the NEXT run's advertised tools; unchecking the last one disables its plugin", async ({
    page
  }) => {
    const mock = await installLiteLLMMock(page, SNIPPET)
    await page.goto('/web/')

    await enableToolTreePlugin(page)
    await enableCodeExecPlugin(page)
    await enableBrowserStatePlugin(page)

    // --- enable plugin -> open tree -------------------------------------------
    // Both tool-contributing plugins show up, each fully checked (nothing has
    // been deselected yet). The tool-tree plugin itself declares no tools, so it
    // never appears as a row — only plugins with >=1 declared tool do.
    const toggle = page.locator(TOGGLE)
    await expect(toggle).toBeVisible()
    await toggle.click()
    const panel = page.locator(PANEL)
    await expect(panel).toBeVisible()

    await expect(page.locator(pluginRow('code-exec'))).toBeVisible()
    await expect(page.locator(toolRow('run_javascript'))).toBeChecked()
    await expect(page.locator(pluginRow('browser-state'))).toBeVisible()
    await expect(page.locator(toolRow('read_dom'))).toBeChecked()

    // --- uncheck a tool -> tool no longer callable ----------------------------
    // browser-state's ONLY declared tool is read_dom, so unchecking it ALSO
    // exercises the "unchecking every tool of a plugin disables that plugin"
    // rule: the row must disappear from the tree, while code-exec's row and its
    // run_javascript checkbox stay untouched.
    await page.locator(toolRow('read_dom')).click()
    await expect(page.locator(pluginRow('browser-state'))).toHaveCount(0)
    await expect(page.locator(pluginRow('code-exec'))).toBeVisible()
    await expect(page.locator(toolRow('run_javascript'))).toBeChecked()

    // Close the panel before sending a prompt: settings only take effect on the
    // NEXT runtime build (see create-runtime.ts), so every tree interaction must
    // land before the turn is sent, not during/after it.
    await panel.getByRole('button', { name: 'Close tool picker' }).click()
    await expect(panel).toBeHidden()

    // Drive a real ReAct tool turn and inspect the EXACT bodies the edge forwarded
    // to LiteLLM: run_javascript must still be advertised (code-exec stays fully
    // enabled); read_dom must NOT be — proving the denylist reached the model's
    // registered tool set, not just the panel's own display state.
    await runSnippetViaChat(page, mock)
    const decideBody = forwardedChatBodies(mock).find(
      (body) => Array.isArray(body.tools) && body.tools.length > 0
    )
    expect(decideBody, 'a decide call should advertise tools').toBeDefined()
    const advertisedNames = decideBody?.tools?.map((tool) => tool.function.name) ?? []
    expect(advertisedNames).toContain('run_javascript')
    expect(advertisedNames).not.toContain('read_dom')

    // --- uncheck all -> plugin disabled (Settings ground truth) --------------
    // The tree already stopped showing browser-state above; now confirm the
    // SOURCE of that — its Settings toggle — actually flipped off too, not just
    // its tree row.
    const browserStateChecked = await readPluginToggleChecked(page, BROWSER_STATE_LABEL)
    expect(
      browserStateChecked,
      'unchecking read_dom (its only tool) should have disabled the browser-state plugin'
    ).toBe(false)

    // code-exec was never touched and stays enabled.
    const codeExecChecked = await readPluginToggleChecked(page, CODE_EXEC_LABEL)
    expect(codeExecChecked).toBe(true)
  })
})
