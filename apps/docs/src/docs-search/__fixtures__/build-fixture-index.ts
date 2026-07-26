// Builds a realistic `search-index.json` payload for tests, using the same
// lunr recipe `buildIndex.js` (pinned @easyops-cn/docusaurus-search-local
// 0.55.2) uses at build time: `ref('i')`, `field('t')`, and a document `i`
// coerced to a string ref. This produces byte-real, loadable lunr indexes, so
// __tests__/private-worker-contract.test.ts can run the plugin's genuine
// `SearchWorker` over them and exercise real query behavior — tokenization,
// wildcards, fuzziness, `smartQueries` relaxation, group iteration and result
// ordering — rather than a hand-rolled stand-in.
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
 *
 * The five groups are emitted in the plugin's own positional order:
 * `[title, heading, description, keywords, content]` (see buildIndex.js).
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

export const PAGE_C_URL = '/docs/plugins-and-tools/plugin-infrastructure/'
export const PAGE_D_URL = '/docs/self-hosting/vercel-deployment/'
export const PAGE_E_URL = '/docs/widgetkit-overview/'

/**
 * A separate, deliberately independent fixture (not an extension of
 * `buildFixtureSearchIndex`, so it can never move that fixture's existing
 * tests' expectations) shaped after the natural-language questions a PR #485
 * review ran against the real site. It exists to demonstrate, through the
 * genuine upstream worker, that recall for those questions comes from the
 * plugin's own query machinery — trailing wildcards on the last term, a
 * `fuzzyMatchingDistance` matrix, and `smartQueries`' leave-one-out relaxation
 * at 3+ terms — and needs no TinyTinkerer-owned query policy on top.
 *
 *  - `PAGE_C` ("Plugin Infrastructure"): its content mentions "plugin",
 *    "infrastructure" and "guides" but never "find", so
 *    "where can I find plugin infrastructure" only matches once a variant that
 *    drops a token is tried.
 *  - `PAGE_D` ("Vercel Deployment Guide") mentions hosting TinyTinkerer, and
 *    is the page "how can I host TinyTinkerer" should surface.
 *  - `PAGE_E` ("WidgetKit Overview") shares no content words with either
 *    question — a control for the precision half: it must NOT be returned for
 *    a hosting question just because one stray token overlaps.
 */
export const buildNaturalLanguageFixtureSearchIndex = (): unknown[] => [
  buildGroupIndex([
    { i: 10, t: 'Plugin Infrastructure', u: PAGE_C_URL, b: ['Docs', 'Plugins and tools'] },
    { i: 20, t: 'Vercel Deployment Guide', u: PAGE_D_URL, b: ['Docs', 'Self hosting'] },
    { i: 22, t: 'WidgetKit Overview', u: PAGE_E_URL, b: ['Docs'] }
  ]),
  buildGroupIndex([
    { i: 12, t: 'Extension points', u: PAGE_C_URL, h: '#extension-points', p: 10 },
    { i: 24, t: 'Hosting TinyTinkerer on Vercel', u: PAGE_D_URL, h: '#hosting', p: 20 }
  ]),
  buildGroupIndex([
    {
      i: 10,
      t: 'How TinyTinkerer plugins are discovered, registered and loaded.',
      s: 'Plugin Infrastructure',
      u: PAGE_C_URL,
      p: 10
    }
  ]),
  buildGroupIndex([]),
  buildGroupIndex([
    {
      i: 11,
      t: 'These plugin infrastructure guides cover extension points and lifecycle hooks.',
      s: 'Extension points',
      u: PAGE_C_URL,
      h: '#extension-points',
      p: 10
    },
    {
      i: 21,
      t: 'This guide covers the full hosted setup: TinyTinkerer on Vercel serves the static frontend, while Cloudflare workers serve the edge API.',
      s: 'Hosting TinyTinkerer on Vercel',
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

export const PAGE_F_URL = '/docs/widget-configuration-reference/'
export const PAGE_G_URL = '/docs/release-notes/'
export const PAGE_H_URL = '/docs/widget-faq/'

/**
 * Pins the ranking-parity rule in search-documentation.ts: raw lunr scores come
 * from five *independent* indexes and are not comparable across them, so page
 * order has to be the worker's own (`sortSearchResults`), not a re-sort by
 * score. This fixture makes the two disagree.
 *
 * For the query "widget", all three pages match weakly in the **title** group
 * (the term is common there and buried in a long field), and `PAGE_G` also
 * matches very strongly in the **content** group. The worker scans the title
 * group first, so `PAGE_G` still lands last — even though its best hit
 * outscores every other page's by an order of magnitude. A score-descending
 * re-sort would therefore promote it to first, which is exactly the divergence
 * from the site's own `/search` page the ordering test guards against.
 */
export const buildOrderingFixtureSearchIndex = (): unknown[] => [
  // Every title mentions "widget", so the term is common here (low idf) and
  // buried in a long field (low length norm) — a weak title-group match.
  buildGroupIndex([
    {
      i: 30,
      t: 'Widget configuration reference guide for advanced integration authors',
      u: PAGE_F_URL,
      b: ['Docs']
    },
    {
      i: 32,
      t: 'Release notes for the widget runtime and its companion command line tooling',
      u: PAGE_G_URL,
      b: ['Docs']
    },
    {
      i: 34,
      t: 'Frequently asked questions about widget packaging and distribution',
      u: PAGE_H_URL,
      b: ['Docs']
    }
  ]),
  buildGroupIndex([]),
  buildGroupIndex([]),
  buildGroupIndex([]),
  // In the content index the term is rare (high idf) and is nearly the whole
  // of a very short section (high length norm) — a strong content-group match.
  buildGroupIndex([
    { i: 35, t: 'Widget.', s: 'Release notes', u: PAGE_G_URL, h: '#widget', p: 32 },
    { i: 36, t: 'Installation prerequisites and supported platforms.', u: PAGE_F_URL, p: 30 },
    { i: 37, t: 'Upgrading from an earlier release of the toolkit.', u: PAGE_F_URL, p: 30 },
    { i: 38, t: 'Reporting bugs and requesting new capabilities.', u: PAGE_H_URL, p: 34 },
    { i: 39, t: 'Publishing a package to the internal registry.', u: PAGE_H_URL, p: 34 },
    { i: 40, t: 'Deprecation policy and long term support windows.', u: PAGE_G_URL, p: 32 }
  ])
]
