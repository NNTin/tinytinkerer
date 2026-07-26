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
