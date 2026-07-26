// Builds a realistic `search-index.json` payload for tests, using the same
// lunr recipe `buildIndex.js` (pinned @easyops-cn/docusaurus-search-local
// 0.55.2) uses at build time: `ref('i')`, `field('t')`, and a document `i`
// coerced to a string ref. This produces byte-real, loadable lunr indexes so
// private-index-adapter.ts is exercised against genuine query behavior, not a
// hand-rolled stand-in. It does NOT protect against upstream changing that
// recipe — the shape-mutation tests alongside this fixture are what assert
// this adapter fails loudly (rather than silently) if the wire format drifts.
import lunr from 'lunr'

type FixtureDoc = {
  i: number
  t: string
  u: string
  p?: number
  h?: string
  s?: string
  b?: string[]
}

const buildGroupIndex = (documents: FixtureDoc[]): { documents: FixtureDoc[]; index: object } => {
  const index = lunr(function build(this: lunr.Builder) {
    this.ref('i')
    this.field('t')
    this.metadataWhitelist = ['position']
    for (const doc of documents) {
      this.add({ ...doc, i: doc.i.toString() })
    }
  })
  return { documents, index: index.toJSON() }
}

export const PAGE_A_URL = '/docs/getting-started/'
export const PAGE_B_URL = '/docs/search-configuration/'

/**
 * Two pages:
 *  - "Getting Started" (`PAGE_A_URL`), matched via its title, a heading
 *    ("Installation"), and a content section — exercising per-page dedup.
 *  - "Search Configuration" (`PAGE_B_URL`), matched only via content.
 */
export const buildFixtureSearchIndex = (): unknown[] => [
  buildGroupIndex([
    { i: 1, t: 'Getting Started', u: PAGE_A_URL, b: ['Docs'] },
    { i: 4, t: 'Search Configuration', u: PAGE_B_URL, b: ['Docs'] }
  ]),
  buildGroupIndex([{ i: 2, t: 'Installation', u: PAGE_A_URL, h: '#installation', p: 1 }]),
  buildGroupIndex([
    {
      i: 6,
      t: 'Learn how to install and configure the toolkit.',
      s: 'Getting Started',
      u: PAGE_A_URL,
      p: 1
    }
  ]),
  buildGroupIndex([]),
  buildGroupIndex([
    {
      i: 3,
      t: 'Run the installer script and follow the interactive prompts to configure your workspace.',
      s: 'Installation',
      u: PAGE_A_URL,
      h: '#installation',
      p: 1
    },
    {
      i: 5,
      t: 'Configure the search index hashing strategy and result limits.',
      s: 'Search Configuration',
      u: PAGE_B_URL,
      h: '#tuning',
      p: 4
    }
  ])
]

export const PAGE_C_URL = '/docs/plugin-infrastructure/'
export const PAGE_D_URL = '/docs/deployment/'
export const PAGE_E_URL = '/docs/widgetkit-overview/'

/**
 * A separate, deliberately independent fixture (not an extension of
 * `buildFixtureSearchIndex`, so it can never change that fixture's existing
 * tests' hit counts) reproducing the two natural-language query shapes a PR
 * #485 review caught returning zero hits under an all-tokens-`REQUIRED`
 * query: a 4-content-word question whose page never repeats every word
 * verbatim in one indexed chunk, and a 2-content-word question whose two
 * words never co-occur at all. See private-index-adapter.ts's tiered query
 * relaxation and README.md for how each tier resolves these.
 *
 *  - `PAGE_C` ("Plugin Infrastructure"): content mentions "plugin",
 *    "infrastructure", "guides" but never "find" — a
 *    "where can I find plugin infrastructure guides" query only matches via
 *    the leave-one-out tier dropping "find" (this holds regardless of the
 *    leave-one-out token-count threshold, since 4 content words exceeds
 *    either candidate threshold).
 *  - `PAGE_D` ("Deployment Guide") mentions "host" but never "widgetkit";
 *    `PAGE_E` ("WidgetKit Overview") mentions "widgetkit" but never "host" —
 *    a "how can I host WidgetKit" query (2 content words) only matches
 *    either page via the lowered leave-one-out threshold's single-word
 *    last-resort tier.
 */
export const buildNaturalLanguageFixtureSearchIndex = (): unknown[] => [
  buildGroupIndex([
    { i: 10, t: 'Plugin Infrastructure', u: PAGE_C_URL, b: ['Docs'] },
    { i: 20, t: 'Deployment Guide', u: PAGE_D_URL, b: ['Docs'] },
    { i: 22, t: 'WidgetKit Overview', u: PAGE_E_URL, b: ['Docs'] }
  ]),
  buildGroupIndex([]),
  buildGroupIndex([]),
  buildGroupIndex([]),
  buildGroupIndex([
    {
      i: 11,
      t: 'These plugin infrastructure guides cover extension points and lifecycle hooks.',
      s: 'Plugin Infrastructure',
      u: PAGE_C_URL,
      h: '#extension-points',
      p: 10
    },
    {
      i: 21,
      t: 'Follow these steps to host your application on any hosting provider.',
      s: 'Deployment Guide',
      u: PAGE_D_URL,
      h: '#hosting',
      p: 20
    },
    {
      i: 23,
      t: 'WidgetKit is the toolkit powering every dashboard widget in this product.',
      s: 'WidgetKit Overview',
      u: PAGE_E_URL,
      h: '#overview',
      p: 22
    }
  ])
]
