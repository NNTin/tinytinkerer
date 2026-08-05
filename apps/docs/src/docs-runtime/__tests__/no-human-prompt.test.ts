// @vitest-environment node
/**
 * The guard behind owner decision 4 (issue #479): no human-in-the-loop host is
 * enabled in the documentation site, because nothing there can raise a prompt.
 *
 * That is a claim about two things at once — that no plugin in either
 * documentation catalogue asks for human input, and that no app-registered tool
 * does — and the host stays off while BOTH hold.
 *
 * **What changed, and what did not (issue #489).** The original decision had a
 * second reason: `requestHumanInput` reached a module-global queue with no
 * session identity, so with the assistant and a live lab in one document a
 * prompt would have been drawn using the wrong app's plugin settings and
 * conversation titles. That is fixed — the queue is one store per `BrowserApp`
 * (see app-browser's human-prompt-bridge.ts), and mounting a host here would no
 * longer misroute anything.
 *
 * The outcome is unchanged anyway, which is why this suite still asserts it:
 * docs has no HITL-capable tool, so the host would render nothing, and every
 * reader would pay a post-boot chunk fetch for it. An unused host is not free
 * (issue #481's finding 5 is the same lesson), so the honest answer is still not
 * to mount one.
 *
 * If a future documentation tool needs human input, this suite fails first —
 * and the fix is now simply to turn the host on, since the routing it was
 * waiting for has landed.
 *
 * **What #495 changed here.** The first case used to assert that
 * `docusaurus.config.ts` aliased plugin discovery to a stub resolving to `[]` —
 * i.e. that docs had NO plugins, which made "no plugin can prompt" true by
 * vacuity. Docs now has plugins. The case is rewritten, not deleted, to say the
 * thing that has to hold instead: neither documentation catalogue contains a
 * HITL-capable plugin. Choice-prompt and permissions are excluded deliberately
 * and that exclusion is what this asserts.
 *
 * The reasons they COULD now be included, and were not, are recorded in
 * `../plugin-subsets.ts`: #489 made the queue per-app so a prompt can no longer
 * misroute, and #498 made a composer-presented prompt visible behind a minimized
 * widget. Neither is a blocker any more; the exclusion is a scope decision.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { appToolCatalogue, createBrowserApp } from '@tinytinkerer/app-browser'
import { createDocumentationToolGroup } from '../../docs-tools'
import { pluginToolPickerDemoToolGroup } from '../../live-lab/plugin-tool-picker/demo-tools'
import { DOCS_ASSISTANT_PLUGINS, DOCS_LAB_PLUGINS } from '../plugin-subsets'

/** The two plugins that reach `PluginHost.requestHumanInput`. */
const HITL_PLUGIN_DIRECTORIES = ['plugin-choice-prompt', 'plugin-permissions'] as const

const readSource = (relativePath: string): string =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8')

describe('no human-in-the-loop capability in docs', () => {
  it('carries no HITL-capable plugin in either documentation catalogue', () => {
    // Rewritten from "discovers no plugins" (issue #495). Docs now has a real,
    // per-app catalogue, so vacuity is gone and this is the statement that has to
    // hold on its own: the two plugins that can raise a prompt are excluded from
    // both documentation apps, deliberately.
    for (const catalogue of [DOCS_ASSISTANT_PLUGINS, DOCS_LAB_PLUGINS]) {
      for (const hitlPlugin of HITL_PLUGIN_DIRECTORIES) {
        expect(catalogue).not.toContain(hitlPlugin)
      }
    }
  })

  it('registers no tool that requests human input, in either docs session', () => {
    // A `Tool` asks for human input through the PluginHost it is executed with;
    // an app tool group has no such hook, and none of these tools names one.
    for (const group of [createDocumentationToolGroup(), pluginToolPickerDemoToolGroup]) {
      for (const tool of appToolCatalogue(group)) {
        expect(tool).not.toHaveProperty('requestHumanInput')
        expect(String(tool['execute'])).not.toMatch(/requestHumanInput/)
      }
    }
  })

  it('builds every docs app without the human-input capability', () => {
    // The OUTCOME, through the real factory, rather than a source-text match on
    // the flag: `app.stores.humanPrompts` is the capability (issue #489 review),
    // so its absence is simultaneously the proof that the runtime advertises no
    // `requestHumanInput` and that no shell will mount a modal. A regex on
    // `humanInput: false` would only have proved somebody wrote it down.
    const app = createBrowserApp(
      { storageNamespace: 'docs-guard' },
      { plugins: () => Promise.resolve([]), humanInput: false }
    )
    expect(app.stores.humanPrompts).toBeUndefined()

    // …and that BOTH docs apps actually pass it (issue #495). This used to check
    // `create-docs-app.ts` for a hardcoded `humanInput: false`, which was one
    // switch for both apps — the granularity bug #495 fixed. The factory now
    // requires the value per app, so the thing to assert is that each call site
    // supplies `false`, and flipping one is visible in the diff that does it.
    for (const callSite of ['../assistant-app.ts', '../../live-lab/client-runtime.tsx']) {
      expect(readSource(callSite)).toMatch(/humanInput:\s*false/)
    }
  })

  it('keeps the assistant owning the document-global hosts it is supposed to', () => {
    const source = readSource('../assistant-runtime-client.tsx')
    expect(source).toMatch(/telemetryConsent:\s*true/)
    expect(source).toMatch(/privacyUpdate:\s*true/)
    expect(source).toMatch(/konami:\s*true/)
  })

  it('mounts every live lab with no document-global host at all', () => {
    const source = readSource('../../live-lab/client-runtime.tsx')
    expect(source).toMatch(/globalHosts=\{NO_GLOBAL_HOST_CAPABILITIES\}/)
  })
})
