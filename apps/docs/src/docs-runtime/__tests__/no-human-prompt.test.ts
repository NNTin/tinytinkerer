// @vitest-environment node
/**
 * The guard behind owner decision 4 (issue #479): no human-in-the-loop host is
 * enabled in the documentation site, because nothing there can raise a prompt.
 *
 * That is a claim about two things at once — that plugin discovery yields
 * nothing, and that no app-registered tool asks for human input — and the host
 * stays off while BOTH hold.
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
 * The plugin-discovery half belongs to #495, which owns removing the webpack
 * alias; it must rewrite the first case below when it does, rather than delete
 * it.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { appToolCatalogue, createBrowserApp } from '@tinytinkerer/app-browser'
import { createDocumentationToolGroup } from '../../docs-tools'
import { pluginToolPickerDemoToolGroup } from '../../live-lab/plugin-tool-picker/demo-tools'

const readSource = (relativePath: string): string =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8')

describe('no human-in-the-loop capability in docs', () => {
  it('discovers no plugins, so no plugin can request human input', async () => {
    // docusaurus.config.ts aliases app-browser's real, `import.meta.glob`-based
    // registry to this webpack stand-in. That alias is the whole reason a HITL
    // prompt is unreachable in the documentation site.
    const { loadPluginModules } = await import('../../live-lab/plugin-registry-stub')
    await expect(loadPluginModules()).resolves.toEqual([])

    // …and the alias that installs it is still configured.
    const config = readSource('../../../docusaurus.config.ts')
    expect(config).toContain('plugin-registry-stub.ts')
    expect(config).toMatch(/app-browser\/src\/plugins\/registry\.ts/)
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
    const app = createBrowserApp({ storageNamespace: 'docs-guard' }, { humanInput: false })
    expect(app.stores.humanPrompts).toBeUndefined()

    // …and that this is what `createDocsBrowserApp` actually passes, for both
    // docs sessions, rather than something a caller could forget per surface.
    const source = readSource('../create-docs-app.ts')
    expect(source).toMatch(/humanInput:\s*false/)
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
