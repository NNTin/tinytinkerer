import { test, expect } from '@playwright/test'
import { openCanvas } from '../fixtures/canvas'
import { enableToolTreePlugin } from '../fixtures/mock-litellm'

// Real-browser verification that the canvas app's OWN tools appear in the compose-
// area tool picker (issue #400 follow-up). The canvas contributes its Excalidraw
// verbs as an app tool group (apps/canvas/src/main.tsx → createBrowserShellRoot
// `appToolGroup`), which is NOT a plugin: it has no activation toggle because
// Excalidraw is intrinsic to the shell. So this spec proves the two rules that a
// jsdom component test (tool-tree.test.tsx) covers against a fake store, but here
// against the REAL canvas shell, its REAL app tool group, and the REAL settings
// store:
//   1. the "Canvas" group and its verbs show up in the picker, and
//   2. unchecking every canvas verb keeps the group in the tree (unlike a plugin,
//      which would disappear) — the app stays running regardless.
//
// The picker itself is gated on the tool-tree plugin being enabled (it owns the
// button's descriptor), so the spec turns that on first via the real Settings UI.
// No chat backend is needed for these UI-level assertions, so it rides openCanvas
// (which blocks **/api/**); the "disabled app tool is excluded from the advertised
// tools array" half of the fix is proven deterministically at the runtime level in
// create-runtime-plugins.test.ts.

const TOGGLE = '[data-testid="tool-tree-toggle"]'
const PANEL = '[data-testid="tool-tree-panel"]'
// The canvas app group id/label come from apps/canvas/src/main.tsx.
const CANVAS_GROUP = '[data-testid="tool-tree-plugin-canvas"]'
const drawRow = '[data-testid="tool-tree-tool-draw"]'
const searchRow = '[data-testid="tool-tree-tool-search"]'

test.describe('canvas tool picker: the app group shows and survives all-unchecked (#400)', () => {
  test('the Canvas group and its verbs appear, and stay when every verb is unchecked', async ({
    page
  }) => {
    await openCanvas(page)

    // The picker only appears once the tool-tree plugin is on (it carries the
    // button's descriptor). Enable it through the real Settings dialog.
    await enableToolTreePlugin(page)

    await page.locator(TOGGLE).click()
    const panel = page.locator(PANEL)
    await expect(panel).toBeVisible()

    // 1. The canvas app's own tools are in the tree, checked by default.
    await expect(panel.locator(CANVAS_GROUP)).toBeVisible()
    await expect(panel.locator(drawRow)).toBeVisible()
    await expect(panel.locator(drawRow)).toBeChecked()
    await expect(panel.locator(searchRow)).toBeChecked()
    // The full verb description is rendered (no longer truncated away).
    await expect(panel).toContainText('Draw shapes, text, arrows, or lines')

    // 2. Uncheck EVERY canvas verb via the group-level checkbox. Unlike a plugin,
    // the group stays in the tree with its verbs unchecked — the canvas is always
    // enabled, so there is nothing to deactivate.
    await panel.locator(CANVAS_GROUP).click()
    await expect(panel.locator(CANVAS_GROUP)).toBeVisible()
    await expect(panel.locator(drawRow)).not.toBeChecked()
    await expect(panel.locator(searchRow)).not.toBeChecked()
  })
})
