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
 * ## What changed under it (issue #495), and why it still reads the same
 *
 * When this suite was written, `read_dom` was unreachable in docs for exactly one
 * reason: `docusaurus.config.ts` aliased plugin discovery to a stub resolving to
 * no plugins. That was a BUILD-CONFIGURATION fact, and #482 wrote the exclusion
 * down as a requirement precisely because the day the alias came out, `read_dom`
 * would become registerable with no test failing.
 *
 * The alias is now gone. Each documentation app names its own catalogue
 * (`docs-runtime/plugin-catalogue.ts`), so "docs has no plugins" is no longer
 * true and was never the guarantee worth having. The assertion is unchanged in
 * spirit and stronger in fact: it reads the REAL catalogues those apps are built
 * with and requires `plugin-browser-state` to be absent from both, by an
 * allowlist rather than a denylist, so a fourth entry is a decision somebody has
 * to make deliberately.
 *
 * Still a source-level approximation of the deployed catalogue. The deployed one
 * is asserted in `packages/e2e/tests/docs/assistant-no-dom-access.e2e.ts`,
 * through Settings and the tool picker on the built site — including with the
 * plugin pre-enabled in the app's own preferences, which is the path a reader
 * would actually take.
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
import { DOCS_ASSISTANT_PLUGINS, DOCS_LAB_PLUGINS } from '../plugin-catalogue'

/** The tool the product's Browser state plugin registers. */
const DOM_READING_TOOL_ID = 'read_dom'

/**
 * …and the package directory that carries it, which is the key a catalogue names
 * it by (`@tinytinkerer/catalogue`'s `CataloguePluginName`). Distinct from
 * `manifest.id`, which is `browser-state`.
 */
const BROWSER_STATE_PLUGIN_DIRECTORY = 'plugin-browser-state'

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

  /**
   * The catalogue itself (issue #495), which is what the previous two cases were
   * a proxy for.
   *
   * They asserted that `docusaurus.config.ts` installed an empty-registry alias
   * and that the stub behind it resolved to `[]`. Both facts are gone with the
   * alias, and neither was ever the guarantee: an empty catalogue excluded
   * `read_dom` the same way it excluded everything, by accident of the build.
   * These replace them with the statement that actually has to hold.
   *
   * An ALLOWLIST in both directions rather than "does not contain
   * plugin-browser-state": what the documentation offers a reader should be a
   * list somebody signed off on, so adding a fourth plugin to either app fails
   * here and has to be argued for in the diff that adds it.
   */
  it('builds both documentation catalogues from an approved list', () => {
    expect([...DOCS_ASSISTANT_PLUGINS]).toEqual(['plugin-tool-tree', 'plugin-context-usage'])
    expect([...DOCS_LAB_PLUGINS]).toEqual([
      'plugin-tool-tree',
      'plugin-context-usage',
      'plugin-code-exec'
    ])
  })

  it('excludes the Browser state plugin from every documentation catalogue', () => {
    // The requirement #482 recorded and #495 had to satisfy: stated as an
    // outcome, so it survives whatever shape the catalogue takes next.
    for (const catalogue of [DOCS_ASSISTANT_PLUGINS, DOCS_LAB_PLUGINS]) {
      expect(catalogue).not.toContain(BROWSER_STATE_PLUGIN_DIRECTORY)
    }
  })

  it('excludes Web search too, so no documentation answer can come from the open web', () => {
    // Not in #495's original text; added there deliberately before implementation
    // (see the issue thread). Two reasons, either sufficient: it is the only
    // plugin shipping `defaultEnabled: true`, so it would arrive switched ON
    // rather than offered; and #478's grounding policy and citation ledger are
    // built on answers coming from authored Markdown, with citations sourced only
    // from successful documentation-tool results.
    for (const catalogue of [DOCS_ASSISTANT_PLUGINS, DOCS_LAB_PLUGINS]) {
      expect(catalogue).not.toContain('plugin-web-search')
    }
  })
})
