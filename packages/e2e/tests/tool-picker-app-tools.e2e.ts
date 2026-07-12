import { test, expect } from '@playwright/test'
import { openCanvas } from '../fixtures/canvas'
import { installChatMock, enableToolTreePlugin } from '../fixtures/mock-litellm'
import { dismissFirstLoad, requireShellPort } from '../fixtures/first-load'

// Real-browser proof that an app's OWN tools are scoped to the app that contributes
// them (issue #400 follow-up). The canvas contributes its Excalidraw verbs as an app
// tool group (apps/canvas/src/main.tsx → createBrowserShellRoot `appToolGroup`); the
// three generic browser shells (web/widget/mobile) pass NO appToolGroup. So with the
// tool picker enabled:
//   - on web/widget/mobile the picker opens but shows NO canvas "Canvas" group / verbs
//     (this file's matrix — one test per shell), and
//   - on the canvas app the "Canvas" group and its verbs DO appear, and survive having
//     every verb unchecked (the canvas is always enabled, so the group is never removed).
//
// The picker itself is gated on the tool-tree plugin being enabled (it owns the
// button's descriptor), so every test turns that on first via the real Settings UI.
// No chat backend is needed for these UI-level assertions.

const TOGGLE = '[data-testid="tool-tree-toggle"]'
const PANEL = '[data-testid="tool-tree-panel"]'
// The canvas app group id/label come from apps/canvas/src/main.tsx; the verb ids come
// from apps/canvas/src/canvas-runtime.ts. No plugin declares an owner id `canvas` or a
// tool id `draw`/`search`, so their absence is a canvas-app-only signal.
const CANVAS_GROUP = '[data-testid="tool-tree-plugin-canvas"]'
const drawRow = '[data-testid="tool-tree-tool-draw"]'
const searchRow = '[data-testid="tool-tree-tool-search"]'
const DRAW_DESCRIPTION = 'Draw shapes, text, arrows, or lines'

// The three browser endpoints are ONE build served from ONE origin at different paths
// (E2E_PORT_WIDGET / E2E_PORT_MOBILE alias E2E_PORT). Matrix: one test per endpoint.
const SHELLS = [
  { name: 'web', url: `http://localhost:${requireShellPort('E2E_PORT')}/web/` },
  { name: 'widget', url: `http://localhost:${requireShellPort('E2E_PORT_WIDGET')}/widget/` },
  { name: 'mobile', url: `http://localhost:${requireShellPort('E2E_PORT_MOBILE')}/mobile/` }
] as const

test.describe('tool picker: canvas app tools are scoped to the canvas app (#400)', () => {
  for (const shell of SHELLS) {
    test(`${shell.name}: canvas Excalidraw tools are NOT shown in the picker`, async ({ page }) => {
      await installChatMock(page)
      await page.goto(shell.url)
      await dismissFirstLoad(page)

      await enableToolTreePlugin(page)

      await page.locator(TOGGLE).click()
      const panel = page.locator(PANEL)
      await expect(panel).toBeVisible()

      // The picker opened, but this shell contributes no app tool group — so the
      // canvas "Canvas" group and its Excalidraw verbs never appear here.
      await expect(panel.locator(CANVAS_GROUP)).toHaveCount(0)
      await expect(panel.locator(drawRow)).toHaveCount(0)
      await expect(panel.locator(searchRow)).toHaveCount(0)
      await expect(panel).not.toContainText(DRAW_DESCRIPTION)
    })
  }

  test('canvas: canvas Excalidraw tools DO show, and stay when every verb is unchecked', async ({
    page
  }) => {
    await openCanvas(page)

    await enableToolTreePlugin(page)

    await page.locator(TOGGLE).click()
    const panel = page.locator(PANEL)
    await expect(panel).toBeVisible()

    // The canvas app's own tools are in the tree, checked by default.
    await expect(panel.locator(CANVAS_GROUP)).toBeVisible()
    await expect(panel.locator(drawRow)).toBeVisible()
    await expect(panel.locator(drawRow)).toBeChecked()
    await expect(panel.locator(searchRow)).toBeChecked()
    // The full verb description is rendered (no longer truncated away).
    await expect(panel).toContainText(DRAW_DESCRIPTION)

    // Uncheck EVERY canvas verb via the group-level checkbox. Unlike a plugin, the
    // group stays in the tree with its verbs unchecked — the canvas is always
    // enabled, so there is nothing to deactivate.
    await panel.locator(CANVAS_GROUP).click()
    await expect(panel.locator(CANVAS_GROUP)).toBeVisible()
    await expect(panel.locator(drawRow)).not.toBeChecked()
    await expect(panel.locator(searchRow)).not.toBeChecked()
  })
})
