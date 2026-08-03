import { test, expect, type Page } from '@playwright/test'
import { dismissTelemetryDialog, requireShellPort } from '../../fixtures/first-load'
import { installChatMock } from '../../fixtures/mock-litellm'
import { PLUGIN_TOOL_PICKER_LAB_URL } from '../../fixtures/docs-lab'
import { assistantLauncher } from '../../fixtures/docs-assistant'

/**
 * The documentation site never offers a tool that reads the rendered page
 * (issue #482), asserted against the **deployed catalogue**.
 *
 * ## Why the tool picker is the wrong place to assert this
 *
 * The first revision of this guard checked the tool picker for `read_dom`, and
 * it would have passed while `read_dom` was one click away. `tool-tree.tsx`
 * lists only **enabled** plugins, and Browser state ships disabled by default —
 * so a docs catalogue that wrongly included it would show nothing in the picker,
 * the assertion would stay green, and a reader could switch it on in Settings
 * and expose `read_dom` anyway.
 *
 * What has to be absent is the plugin from the **catalogue**, not the tool from
 * the picker. So this asserts, for both documentation `BrowserApp`s:
 *
 * 1. Settings → Plugins does not offer Browser state — the catalogue itself;
 * 2. with Browser state **pre-seeded as enabled** in that app's own preferences,
 *    `read_dom` is still absent from the tool picker. That is the reader's path
 *    made concrete: activation state cannot conjure a plugin the catalogue omits.
 *
 * Which of those actually carries the guarantee was settled by experiment, not
 * by argument: with a Browser state module injected into the docs registry and
 * the site rebuilt, only the **tool-picker** assertions turned red. The
 * Settings-text ones stayed green, so they are corroboration and are labelled as
 * such rather than trusted.
 *
 * Today both hold because `docusaurus.config.ts` aliases plugin discovery to an
 * empty registry. #495 replaces that alias with a real injected catalogue, and
 * these are the assertions it has to keep true.
 */
const DOCS_ORIGIN = `http://localhost:${requireShellPort('E2E_PORT')}`
const AUTHORED_ROUTE = `${DOCS_ORIGIN}/docs/architecture/`

const ASSISTANT_NAMESPACE = 'tinytinkerer-docs-assistant'
const LAB_NAMESPACE = 'tinytinkerer-docs-lab'
const BROWSER_STATE_PLUGIN_ID = 'browser-state'
/** `settings.ts`'s `SETTINGS_KEYS.pluginActivation`. */
const PLUGIN_ACTIVATION_KEY = 'settings_plugins_activation'

/**
 * Pre-enable Browser state in one app's own preferences, before it boots.
 *
 * Writes the same key `persistPluginActivation` writes, into the same
 * per-namespace database the app reads at bootstrap — so from the app's point of
 * view this is indistinguishable from a reader having switched the plugin on in
 * a previous session.
 */
const seedPluginEnabled = async (page: Page, storageNamespace: string): Promise<void> => {
  await page.addInitScript(
    ([namespace, key, pluginId]: string[]) => {
      // Opaque-origin iframes (the Pixel Agents office) cannot open IndexedDB,
      // and nothing there reads this — skip rather than throw into the console.
      if (window.top !== window.self) return undefined
      return new Promise<void>((resolve, reject) => {
        const request = indexedDB.open(namespace!, 3)
        request.onupgradeneeded = () => {
          const db = request.result
          if (!db.objectStoreNames.contains('preferences')) {
            db.createObjectStore('preferences', { keyPath: 'key' })
          }
          if (!db.objectStoreNames.contains('conversations')) {
            db.createObjectStore('conversations', { keyPath: 'id' }).createIndex(
              'updatedAt',
              'updatedAt'
            )
          }
          if (!db.objectStoreNames.contains('events')) {
            const events = db.createObjectStore('events', { keyPath: 'id' })
            events.createIndex('conversationId', 'conversationId')
            events.createIndex('timestamp', 'timestamp')
          }
        }
        request.onsuccess = () => {
          const db = request.result
          const tx = db.transaction('preferences', 'readwrite')
          tx.objectStore('preferences').put({
            key: key!,
            value: JSON.stringify({ [pluginId!]: true })
          })
          tx.oncomplete = () => {
            db.close()
            resolve()
          }
          tx.onerror = () => reject(tx.error ?? new Error('Failed to seed plugin activation.'))
        }
        request.onerror = () => reject(request.error ?? new Error('Failed to open the database.'))
      })
    },
    [storageNamespace, PLUGIN_ACTIVATION_KEY, BROWSER_STATE_PLUGIN_ID]
  )
}

/**
 * The Settings surface, in either presentation.
 *
 * The assistant's floating panel renders it `inline`; the docked surface a live
 * lab renders uses the `modal` presentation. Matching on the label alone, with
 * the presentation left open, is what lets one helper serve both — and asserting
 * against only the inline form was why the lab case first failed to find it.
 */
const settingsPanel = (page: Page) => page.locator('[data-presentation][aria-label="Settings"]')

const openAssistantSettings = async (page: Page): Promise<void> => {
  await assistantLauncher(page).click()
  await expect(
    page.locator('.docs-assistant-root').getByRole('textbox', { name: 'Message' })
  ).toBeVisible({ timeout: 30_000 })
  await dismissTelemetryDialog(page)
  await page.locator('.docs-assistant-root').getByRole('button', { name: 'Settings' }).click()
  await expect(settingsPanel(page)).toBeVisible()
}

test.describe('no documentation session offers a DOM-reading tool (#482)', () => {
  test('the assistant catalogue does not contain Browser state', async ({ page }) => {
    await installChatMock(page)
    await page.goto(AUTHORED_ROUTE)
    await openAssistantSettings(page)

    // The catalogue, not the activation state. An empty catalogue says so.
    await expect(settingsPanel(page)).not.toContainText('Browser state')
    await expect(settingsPanel(page)).not.toContainText('read_dom')
  })

  test('enabling Browser state beforehand still exposes no read_dom to the assistant', async ({
    page
  }) => {
    // The reader's path, made concrete: a persisted activation for a plugin the
    // catalogue does not carry must stay inert.
    await seedPluginEnabled(page, ASSISTANT_NAMESPACE)
    await installChatMock(page)
    await page.goto(AUTHORED_ROUTE)
    await openAssistantSettings(page)
    await expect(settingsPanel(page)).not.toContainText('Browser state')

    await page.keyboard.press('Escape')
    await page
      .locator('.docs-assistant-root')
      .getByRole('button', { name: 'Choose available tools' })
      .click()
    const picker = page.getByRole('dialog', { name: 'Choose available tools' })
    await expect(picker).toBeVisible()
    // The three documentation tools are there, and `read_dom` is not — with the
    // plugin already switched on.
    await expect(picker.getByRole('checkbox', { name: 'search_docs' })).toBeVisible()
    await expect(picker.getByRole('checkbox', { name: 'read_dom' })).toHaveCount(0)
    await expect(picker).not.toContainText('Browser state')
  })

  test('a live lab carries the same exclusion, with its own catalogue', async ({ page }) => {
    // The other documentation `BrowserApp`. It has a different storage namespace
    // and a different tool group, so its catalogue is a separate boundary —
    // #495 has to satisfy both.
    await seedPluginEnabled(page, LAB_NAMESPACE)
    await installChatMock(page)
    // The plugin & tool-picker lab, because it is the one that renders a real
    // `ChatApp` — and therefore the only lab with a Settings panel to inspect.
    // The Pixel Agents lab renders the office instead.
    await page.goto(PLUGIN_TOOL_PICKER_LAB_URL)

    // `data-live-lab`, not a `.live-lab` class: the framework renders the former
    // and only its inner elements use the latter as a prefix.
    const lab = page.locator('[data-live-lab]').first()
    await expect(lab).toBeVisible({ timeout: 30_000 })
    await lab.getByRole('button', { name: 'Settings' }).first().click()
    await expect(settingsPanel(page)).toBeVisible()
    await expect(settingsPanel(page)).not.toContainText('Browser state')
    await expect(settingsPanel(page)).not.toContainText('read_dom')
    await page.keyboard.press('Escape')

    // …and the same question asked where it can actually be answered: what tools
    // this session offers. The Settings assertions above are corroboration —
    // verified against an injected Browser state catalogue, only THIS one turned
    // red, so it is the assertion carrying the guarantee.
    await page.getByRole('button', { name: 'Choose available tools' }).first().click()
    const picker = page.getByRole('dialog', { name: 'Choose available tools' })
    await expect(picker).toBeVisible()
    await expect(picker.getByRole('checkbox', { name: 'read_dom' })).toHaveCount(0)
    await expect(picker).not.toContainText('Browser state')
  })
})
