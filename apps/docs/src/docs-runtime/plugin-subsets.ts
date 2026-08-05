/**
 * Which plugins each documentation app carries (issue #495).
 *
 * Two lists rather than one, and both of them partial. The partiality is the
 * point: #482 deferred this work on the condition that a documentation catalogue
 * is an *explicit* subset, because the previous arrangement — a webpack alias
 * resolving plugin discovery to `[]` — excluded everything by build accident and
 * would have started including everything the day the alias came out.
 *
 * Isolation and contents are separate questions. The two apps already hold
 * independent activation and settings, by being separate `BrowserApp`s in
 * separate IndexedDB namespaces; that is not what these lists are for. These
 * lists say what each app *offers*, and the two answers differ because the two
 * surfaces do different jobs.
 *
 * ## This file is the worked example of a convention (issue #501)
 *
 * It was called `plugin-catalogue.ts`, one import away from
 * `@tinytinkerer/catalogue`, which means the opposite thing: that package names
 * every plugin that EXISTS, this module names the subset a surface OFFERS.
 * Renamed rather than left as a reading hazard, because the shape below is the
 * pattern the next surface should copy, and a pattern whose name misleads is
 * worse than no pattern.
 *
 * The convention, written up for a new surface in
 * `docs/plugins-and-tools/plugin-infrastructure.md`:
 *
 * 1. a subset lives with the APP that owns it, not in the catalogue package —
 *    the reasons are product policy (docs' exclusions are #478 grounding-policy
 *    arguments), and product policy does not belong in a product-neutral
 *    package;
 * 2. it is a named `as const satisfies readonly CataloguePluginName[]` export,
 *    so a plugin renamed or removed from the workspace is a compile error here
 *    rather than a silently missing toggle;
 * 3. every exclusion carries its reason in the module, as below;
 * 4. a guard test asserts the list by ALLOWLIST in both directions —
 *    `__tests__/no-dom-access.test.ts` and `__tests__/no-human-prompt.test.ts`
 *    are the worked examples — so a fourth entry is a decision somebody has to
 *    argue for in the diff that adds it.
 *
 * ## What #472's Pixel Agents Office gets, decided here rather than there
 *
 * The Office does NOT need a subset of its own, and #501 exists partly because
 * that was never written down. #472's locked decision (its
 * `5147336205` comment, amended by #490's surface-contract comment) makes the
 * Office a portaled SURFACE inside the assistant's `BrowserApp` — deliberately,
 * to preserve "one assistant app and one conversation repository … no second,
 * office-specific store". A plugin subset is per-`BrowserApp` by construction:
 * `createBrowserApp({ plugins })` memoizes one `app.loadPlugins`, and
 * `usePluginModules` reads it from context, so every surface registered through
 * `registerDocsAssistantSurface` shares whatever the assistant carries.
 *
 * So the Office inherits {@link DOCS_ASSISTANT_PLUGINS} — the tool picker and
 * the context gauge. That is a reasonable answer for a conversation-management
 * surface, and it is an answer #495 made on #472's behalf. Giving the Office a
 * different one would mean a second `BrowserApp`, which #472 rejected.
 *
 * ## The exclusions, and why each one is a decision
 *
 * **`plugin-browser-state` (`read_dom`) — excluded from both, permanently.**
 * #471's first locked decision is that documentation content comes from authored
 * Markdown and never the rendered page. This is the requirement #482 wrote down
 * precisely because the old exclusion rested on a build alias and would have
 * evaporated silently here. It is asserted as an OUTCOME in
 * `__tests__/no-dom-access.test.ts` and, on the built site, in
 * `packages/e2e/tests/docs/assistant-no-dom-access.e2e.ts`.
 *
 * **`plugin-web-search` — excluded from both.** Two independent reasons. It is
 * the only plugin in the workspace with `defaultEnabled: true`, so it would
 * arrive switched on rather than offered. And it lets the assistant answer from
 * the open web, while #478's grounding policy and citation ledger are built on
 * answers coming from authored Markdown with citations sourced only from
 * successful documentation-tool results.
 *
 * **`plugin-choice-prompt` and `plugin-permissions` — excluded from both.** Both
 * reach `requestHumanInput`. The reasons they were previously impossible are
 * gone (#489 made the prompt queue per-app, #498 made a prompt visible behind a
 * minimized widget), so this is now a scope decision rather than a constraint:
 * enabling them pulls the modal and composer-dock chunks into the documentation
 * for demonstration value that can land on its own. Both documentation apps
 * therefore still declare `humanInput: false` — see `createDocsBrowserApp`,
 * which now takes that per app rather than deciding it for both.
 *
 * **`plugin-feedback`, `plugin-event-logger`, `plugin-context-inspector` —
 * excluded from both.** No exclusion principle, just not offered: the first
 * sends reader-authored content to the edge, and the other two are
 * developer-facing aids whose audience is the product, not a documentation
 * reader.
 */
import type { CataloguePluginName } from '@tinytinkerer/catalogue'

/**
 * The global documentation assistant's catalogue.
 *
 * Presentation-only: neither plugin contributes a tool, so neither adds a way to
 * produce an answer that #478's citation ledger then has to reason about. That
 * is the whole selection rule for this surface — the assistant is the app under
 * the grounding policy, and a tool added here is a new answer path.
 *
 * `plugin-tool-tree` also settles something that had been a workaround:
 * `create-docs-app.ts` attached `genericToolTreeSummarizer` unconditionally
 * *because* no plugin could ever contribute one here. Now one can, so the
 * fallback is a real decision rather than a consequence of the alias.
 */
export const DOCS_ASSISTANT_PLUGINS = [
  'plugin-tool-tree',
  'plugin-context-usage'
] as const satisfies readonly CataloguePluginName[]

/**
 * The shared live-lab app's catalogue.
 *
 * The assistant's two, plus `plugin-code-exec`. The live labs are where the
 * documentation *demonstrates* the plugin system — `live-lab/plugin-tool-picker`
 * exists to show a reader plugin activation and the tool picker, and until now it
 * had to fake it with an `appToolGroup` because docs could not reach a real
 * plugin at all. This is the change that makes a real one available, so the demo
 * should use one.
 *
 * `plugin-code-exec` specifically because it is the only non-HITL tool plugin
 * that executes entirely in the browser: no edge call, no shared quota, no
 * third-party service. That is what makes "enable and execute a plugin end to
 * end" testable on the built site without spending anything.
 *
 * It is worth being explicit that this is NOT a `read_dom` loophole, because the
 * two are adjacent by design. `create-runtime.ts` holds a `domSnapshot` that
 * `run_javascript` receives as its `dom` binding — but that snapshot is written
 * only by `createDomReader`, i.e. only by `read_dom` itself, and capture is armed
 * only when both tools are registered. With `plugin-browser-state` absent from
 * this list the snapshot is never written and the binding stays `null`. The
 * sandbox cannot read the page on its own: it runs in an opaque-origin iframe
 * (`sandbox="allow-scripts"` without `allow-same-origin`) under a CSP that blocks
 * every network and resource load.
 */
export const DOCS_LAB_PLUGINS = [
  'plugin-tool-tree',
  'plugin-context-usage',
  'plugin-code-exec'
] as const satisfies readonly CataloguePluginName[]
