import { test, expect, type Page } from '@playwright/test'
import { dismissFirstLoad, requireShellPort } from '../fixtures/first-load'

// Real-browser coverage of the Konami cheat code (GitHub issue #399): typing
// ↑ ↑ ↓ ↓ ← → ← → B A anywhere in the app applies a settings preset and plays a
// purely-presentational easter-egg animation. No LiteLLM mock is installed —
// this spec never sends a chat message, so nothing here talks to the model.
//
// The sequence + preset live in one file, packages/app/app-browser/src/konami/konami-config.ts.
// Unit coverage (packages/app/app-browser/tests/konami-recognizer.test.ts and
// konami-preset.test.ts) exercises the recognizer and the preset application in
// isolation; this spec is the one thing those can't cover — a REAL keydown
// sequence, in a real DOM, actually reaching the listener and flipping the real
// Settings UI, plus the Web Animations API actually running to completion.
const WEB_URL = `http://localhost:${requireShellPort('E2E_PORT')}/web/`

const KONAMI_KEYS = [
  'ArrowUp',
  'ArrowUp',
  'ArrowDown',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'ArrowLeft',
  'ArrowRight',
  'b',
  'a'
]

// The ten Settings toggles the preset flips on, by their exact accessible
// label (manifest `label` for plugins; the ToggleRow `label` prop for the two
// Interface prefs and the Telemetry toggle).
const CORE_TOGGLE_LABELS = [
  'Show reasoning & activity',
  'Enable voice input (Web Speech API)',
  'Enable telemetry'
]
const PLUGIN_TOGGLE_LABELS = [
  'Choice prompt (ask you a question)',
  'Code execution (run_javascript tool)',
  'Context inspector (developer)',
  'Context usage gauge',
  'Event Logger (developer console)',
  'Tool picker (tree view)',
  'Web search (Tavily)'
]

// READ-ONLY settings assertion. Deliberately NOT the shared `enablePlugin`
// helper: that helper clicks an unchecked toggle on before asserting, so a
// preset that silently failed to apply would be masked — the helper itself
// would enable the setting and the assertion would pass. This one only reads.
// (It borrows enablePlugin's open/reveal mechanics: the settings surface is
// tabbed and only the active tab's panel is mounted, so each label may need a
// tab switch to become visible.)
const assertTogglesChecked = async (page: Page, labels: readonly string[]): Promise<void> => {
  const settingsDialog = page.getByRole('dialog', { name: 'Settings' })
  if (!(await settingsDialog.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'Settings' }).click()
    await expect(settingsDialog).toBeVisible()
  }
  for (const label of labels) {
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
    await expect(page.getByRole('checkbox', { name: label })).toBeChecked()
  }
  // Close via the X inside the dialog (the backdrop also carries the
  // "Close settings" label, so scope the click to the dialog).
  await settingsDialog.getByRole('button', { name: 'Close settings' }).click()
  await expect(settingsDialog).toBeHidden()
}

test.describe('Konami cheat code (#399)', () => {
  test('typing the sequence in the composer applies the preset and plays the reverting animation', async ({
    page
  }) => {
    await page.goto(WEB_URL)
    await dismissFirstLoad(page)

    // Focus the composer FIRST, then type the whole sequence into it — proving
    // the listener isn't capture-phase-only and doesn't require chrome focus.
    // The composer is a plain <textarea>; typing 'b'/'a' inserts those letters
    // into it, which is expected and irrelevant here — this spec never asserts
    // composer content, only that the cheat code still fires.
    const composer = page.locator('textarea').first()
    await composer.click()
    for (const key of KONAMI_KEYS) {
      await page.keyboard.press(key)
    }

    // The animation starts (data-konami="active" on <html>, the e2e hook
    // easter-egg-animation.ts sets/clears) ...
    await expect(page.locator('html')).toHaveAttribute('data-konami', 'active', {
      timeout: 5_000
    })
    // ... and finishes — every element's forward+reverse animation settled and
    // the attribute is cleared, leaving no lasting DOM state.
    await expect(page.locator('html')).not.toHaveAttribute('data-konami', 'active', {
      timeout: 15_000
    })

    // The preset applied: open Settings once and confirm each of the ten
    // toggles is checked, without ever clicking one.
    const allLabels = [...CORE_TOGGLE_LABELS, ...PLUGIN_TOGGLE_LABELS]
    await assertTogglesChecked(page, allLabels)

    // The preset PERSISTED: the cheat code writes through the same preference
    // keys the settings modal writes, so a reload must come back with all nine
    // still on (issue #399's whole point — skip re-toggling per PR preview).
    await page.reload()
    await dismissFirstLoad(page, 4_000)
    await assertTogglesChecked(page, allLabels)
  })
})
