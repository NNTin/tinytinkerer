import { test, expect, type Page } from '@playwright/test'
import {
  installChatMock,
  enablePlugin,
  dismissTelemetryDialog,
  SYNTHESIS_ANSWER
} from '../fixtures/mock-litellm'
import { discoverPlugins, type DiscoveredPlugin } from '../fixtures/discover-plugins'

// =============================================================================
// Plugin matrix: the SAME baseline conversation under DIFFERENT plugin
// configurations (GitHub issue #268).
// =============================================================================
//
// One generic, plugin-AGNOSTIC chat turn is run under several enable/disable
// configurations; each asserts the assistant reply still STREAMS TO COMPLETION.
// The point is a regression guard that no optional plugin breaks a normal
// conversation when toggled on (alone or together).
//
// AUTO-DISCOVERY
// --------------
// The configurations are derived from the live plugin set, discovered node-side
// at collection time (see fixtures/discover-plugins.ts) the same way the browser
// host discovers plugins via its Vite glob. So a NEWLY ADDED plugin package
// automatically gets matrix coverage with ZERO edits to this file — labels and
// activation ids are read from each `manifest`, never hard-coded here.
//
// EXEMPTIONS — a DENYLIST, not an includelist
// -------------------------------------------
// A plugin is covered UNLESS its `manifest.id` is in EXEMPT_PLUGIN_IDS. Using a
// denylist (vs. an includelist) is what makes new plugins auto-enrol: you opt a
// plugin OUT only when it needs extra UI steps a generic baseline turn cannot
// drive safely. Each exemption carries a one-line reason. The fix for such a
// plugin is to add it here — never to special-case it in the test body.
const EXEMPT_PLUGIN_IDS: Record<string, string> = {
  // Gates every tool behind a confirmation modal (allow/deny). A baseline turn
  // would block on that extra UI; it has its own coverage in permissions.e2e.ts.
  permissions: 'injects a tool-confirmation modal requiring extra approve/deny UI steps'
}

// THE MATRIX (justified — not full 2^N)
// -------------------------------------
// A full power set of N non-exempt plugins is 2^N runs (128+ today) of an
// identical conversation — cost without proportional signal, and it grows
// exponentially as plugins are added. We cover the failure modes that actually
// matter for "a plugin broke a normal turn":
//   (a) DEFAULTS        — nothing toggled (only `defaultEnabled` plugins active);
//   (b) EACH-ALONE      — every non-exempt plugin enabled on its own, isolating
//                         any single plugin that breaks a baseline turn;
//   (c) ALL-TOGETHER    — every non-exempt plugin enabled at once, catching
//                         cross-plugin interference the singles cannot.
// That is N+2 runs (linear in the plugin count), which scales as plugins land.
type MatrixConfig = {
  name: string
  // Settings labels to enable for this config, read from each plugin's manifest.
  labels: string[]
}

const buildMatrix = (plugins: DiscoveredPlugin[]): MatrixConfig[] => {
  const eligible = plugins.filter((plugin) => !(plugin.id in EXEMPT_PLUGIN_IDS))
  return [
    { name: 'defaults (nothing toggled)', labels: [] },
    ...eligible.map((plugin) => ({
      name: `only ${plugin.id} enabled`,
      labels: [plugin.label]
    })),
    {
      name: `all non-exempt enabled (${eligible.map((plugin) => plugin.id).join(', ')})`,
      labels: eligible.map((plugin) => plugin.label)
    }
  ]
}

// Clears the first-load dialogs (telemetry consent + an auto-opened Settings
// modal) WITHOUT toggling anything — the "defaults" path, where no plugin is
// enabled. enablePlugin already does this when a config does enable plugins.
const clearFirstLoadDialogs = async (page: Page): Promise<void> => {
  await dismissTelemetryDialog(page)
  const settings = page.getByRole('dialog', { name: 'Settings' })
  if (await settings.isVisible().catch(() => false)) {
    await settings.getByRole('button', { name: 'Close settings' }).click()
    await expect(settings).toBeHidden()
  }
}

// The generic, plugin-AGNOSTIC baseline: a plain chat turn with no tool use, so
// it completes regardless of which plugins are on (the NO-TOOL chat mock answers
// directly and synthesizes — see fixtures/mock-litellm.ts). The reply rendering
// is the DOM signal the assistant stream reached completion (same assertion the
// sibling specs use, e.g. event-logger / context-usage).
const BASELINE_PROMPT = 'Say hello so the assistant streams a normal reply.'

const runBaselineConversation = async (page: Page): Promise<void> => {
  await page.getByPlaceholder('Ask anything').fill(BASELINE_PROMPT)
  await page.getByRole('button', { name: 'Send' }).click()
  await expect(page.getByText(SYNTHESIS_ANSWER)).toBeVisible()
}

// Discovery runs at collection time so each configuration is its own reported
// test. Top-level await is fine in a Playwright ESM spec.
const plugins = await discoverPlugins()
const matrix = buildMatrix(plugins)

test.describe('plugin matrix: baseline conversation under plugin configs (#268)', () => {
  for (const config of matrix) {
    test(`${config.name}: assistant stream completes`, async ({ page }) => {
      await installChatMock(page)
      await page.goto('/web/')

      if (config.labels.length === 0) {
        await clearFirstLoadDialogs(page)
      } else {
        for (const label of config.labels) {
          await enablePlugin(page, label)
        }
      }

      await runBaselineConversation(page)
    })
  }
})
