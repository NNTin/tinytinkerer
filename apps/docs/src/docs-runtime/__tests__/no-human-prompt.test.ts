// @vitest-environment node
/**
 * The guard behind owner decision 4 (issue #479): no human-in-the-loop host is
 * enabled in the documentation site, because nothing there can raise a prompt.
 *
 * That is a claim about two things at once — that plugin discovery yields
 * nothing, and that no app-registered tool asks for human input — and it is only
 * safe while BOTH hold. `requestHumanInput` reaches a module-global queue with
 * no session identity (see human-prompt-bridge.ts), so with the assistant and a
 * live lab in one document a prompt would be drawn using the wrong app's plugin
 * settings and conversation titles. Session-scoped routing is #489.
 *
 * If a future documentation tool needs human input, this suite fails first, and
 * the fix is #489 rather than quietly enabling a misroutable host.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { appToolCatalogue } from '@tinytinkerer/app-browser'
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

  it('mounts the assistant shell with the human-prompt host switched off', () => {
    const source = readSource('../assistant-runtime-client.tsx')
    expect(source).toMatch(/humanPrompt:\s*false/)
    // The hosts the assistant DOES own, for the whole documentation site.
    expect(source).toMatch(/telemetryConsent:\s*true/)
    expect(source).toMatch(/privacyUpdate:\s*true/)
    expect(source).toMatch(/konami:\s*true/)
  })

  it('mounts every live lab with no document-global host at all', () => {
    const source = readSource('../../live-lab/client-runtime.tsx')
    expect(source).toMatch(/globalHosts=\{NO_GLOBAL_HOST_CAPABILITIES\}/)
  })
})
