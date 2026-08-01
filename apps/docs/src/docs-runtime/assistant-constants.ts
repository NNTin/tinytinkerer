/**
 * Identity and copy for the global documentation assistant (issue #479).
 *
 * Deliberately a light module — no product-runtime import — so the Root-mounted
 * host, the surface registry, and tests can read these without pulling the
 * assistant runtime chunk onto every documentation page.
 */

/**
 * The assistant's own IndexedDB database. Distinct from the product's default
 * namespace (`tinytinkerer`) and from the live labs'
 * (`tinytinkerer-docs-lab`), so assistant conversations, settings, and model
 * selection never appear in — or overwrite — either.
 *
 * #472 consumes this session rather than opening a second store of its own.
 */
export const DOCS_ASSISTANT_STORAGE_NAMESPACE = 'tinytinkerer-docs-assistant'

/**
 * The `localStorage` key holding whether the panel is open or minimized (issue
 * #480), and the versioned value under it.
 *
 * Deliberately not in the IndexedDB namespace above: presentation is not
 * conversation data, and #479's reset preserves it precisely because a reader who
 * starts a new conversation has not asked for the panel to collapse.
 */
export const DOCS_ASSISTANT_PRESENTATION_STORAGE_KEY = 'tinytinkerer:docs-assistant-presentation'

/**
 * Where `FloatingLayout` persists the widget's geometry. Its own key, because the
 * layout owns position and size while the presentation store above owns
 * open/minimized — see assistant-presentation.ts for why those are separate.
 */
export const DOCS_ASSISTANT_LAYOUT_STORAGE_KEY = 'tinytinkerer:docs-assistant-layout:v1'

/** The id the floating widget registers under in the #479 surface registry. */
export const DOCS_ASSISTANT_WIDGET_SURFACE_ID = 'docs-assistant-widget'

/**
 * Cold-start prompts for the assistant's empty conversation.
 *
 * Route-NEUTRAL by decision (issue #479): the assistant is present on every
 * `/docs/` route, including search results and 404s, so a static starter has to
 * read correctly where there is no current document. "Summarize this page" and
 * "Explain this section" are route-aware and belong to #480, which offers them
 * only when #476 reports an authored current document.
 */
export const DOCS_ASSISTANT_STARTER_PROMPTS: readonly string[] = [
  'How can I host TinyTinkerer?',
  'Where can I find the plugin and tool documentation?',
  "Explain how TinyTinkerer's packages fit together."
]
