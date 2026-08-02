// @vitest-environment node
/**
 * The documentation site never offers a tool that reads the rendered page
 * (issue #482).
 *
 * #471's first locked decision is that documentation content comes from authored
 * Markdown and nothing else. `docs-tools/__tests__/source-rules.test.ts` already
 * proves the three documentation tools do not touch the DOM themselves; this is
 * the other half of the claim — that no OTHER tool in a documentation session
 * offers to, in particular the product's own `read_dom`.
 *
 * ## Why the assertion is worth having even though it passes today
 *
 * `read_dom` cannot be reached in docs for one reason: `docusaurus.config.ts`
 * aliases plugin discovery to a stub that resolves to no plugins. That is a
 * BUILD-CONFIGURATION fact, and the reviewer of #491 has asked for it to change
 * — an injected per-`BrowserApp` plugin catalogue, tracked as a follow-up to
 * #489. When it does, "docs has no plugins" stops being the thing that keeps
 * `read_dom` out, and the exclusion has to be stated somewhere that fails.
 *
 * This is that somewhere. It deliberately adds no denylist, no second catalogue,
 * and no mechanism: it asserts the OUTCOME against the real tool groups and the
 * real plugin loader, so whatever shape the catalogue eventually takes, a docs
 * session that starts advertising `read_dom` fails here first.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { appToolCatalogue } from '@tinytinkerer/app-browser'
import { createDocumentationToolGroup } from '../../docs-tools'
import {
  READ_CURRENT_DOC_TOOL_ID,
  READ_DOC_TOOL_ID,
  SEARCH_DOCS_TOOL_ID
} from '../../docs-tools/tools'
import { pluginToolPickerDemoToolGroup } from '../../live-lab/plugin-tool-picker/demo-tools'

/** The tool the product's Browser state plugin registers. */
const DOM_READING_TOOL_ID = 'read_dom'

/**
 * …read back out of the plugin, so a rename there fails HERE rather than
 * silently leaving this suite asserting something about a tool that no longer
 * exists under that name.
 *
 * Read as text rather than imported: `scripts/check-boundaries.mjs` forbids
 * `apps/docs` from depending on a concrete `@tinytinkerer/plugin-*` package, and
 * that rule is a large part of why `read_dom` cannot reach the documentation in
 * the first place. Satisfying this test by breaking it would be an odd trade.
 */
const browserStatePluginSource = (): string =>
  readFileSync(
    fileURLToPath(
      new URL('../../../../../packages/plugins/plugin-browser-state/src/index.ts', import.meta.url)
    ),
    'utf8'
  )

describe('no documentation session offers a DOM-reading tool', () => {
  it('still names the tool this suite is about', () => {
    expect(browserStatePluginSource()).toContain(`id: '${DOM_READING_TOOL_ID}'`)
  })

  it('registers exactly the three documentation tools, and nothing else', () => {
    // An allowlist rather than "does not contain read_dom": a fourth tool
    // arriving in this group is a decision somebody should have to make
    // deliberately, whatever it happens to be called.
    expect(appToolCatalogue(createDocumentationToolGroup()).map((tool) => tool.id)).toEqual([
      SEARCH_DOCS_TOOL_ID,
      READ_DOC_TOOL_ID,
      READ_CURRENT_DOC_TOOL_ID
    ])
  })

  it('registers no DOM-reading tool in either docs session', () => {
    for (const group of [createDocumentationToolGroup(), pluginToolPickerDemoToolGroup]) {
      for (const tool of appToolCatalogue(group)) {
        expect(tool.id).not.toBe(DOM_READING_TOOL_ID)
      }
    }
  })

  it('discovers no plugin at all, so Browser state cannot register one', async () => {
    // The same stub `no-human-prompt.test.ts` pins, asserted here for the other
    // capability it currently holds back. When the catalogue becomes injected
    // (the #489 follow-up), this expectation is what has to be rewritten into
    // "the docs catalogue excludes Browser state" — deliberately, and in a diff
    // somebody reviews.
    const { loadPluginModules } = await import('../../live-lab/plugin-registry-stub')
    expect(await loadPluginModules()).toEqual([])
  })
})
