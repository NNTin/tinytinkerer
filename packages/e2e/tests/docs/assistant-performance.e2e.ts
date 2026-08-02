import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test, expect, type Page, type Request } from '@playwright/test'
import { dismissTelemetryDialog, requireShellPort } from '../../fixtures/first-load'
import {
  installAppToolMock,
  installChatMock,
  SYNTHESIS_ANSWER,
  toolResultFor
} from '../../fixtures/mock-litellm'
import {
  assistantComposer,
  assistantLauncher,
  sendAssistantPrompt
} from '../../fixtures/docs-assistant'

// What the documentation assistant costs, and — more importantly — WHEN (issue
// #481).
//
// The static half of this lives in `scripts/check-docs-performance-budget.mjs`,
// which weighs what a built page references and how big the corpus and search
// artifacts are. It cannot see sequencing: whether a document body is fetched on
// page load or only when a tool reads one is a fact about a running browser, and
// this is where that is established.
//
// The two halves read the SAME checked-in table, so a budget cannot be raised in
// one place and quietly left alone in the other.
const BUDGET = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../../../config/docs-performance-budget.json', import.meta.url)),
    'utf8'
  )
) as {
  profiles: Record<string, BudgetProfile | undefined>
}

type BudgetProfile = {
  label: string
  maxBytes: number
  /** Only the search profile has a second, browser-measured bound. */
  maxWorkerBytes?: number
  note: string
}

/** Fails loudly on a profile this spec names but the table does not define. */
const profile = (key: string): BudgetProfile => {
  const entry = BUDGET.profiles[key]
  if (!entry) {
    throw new Error(
      `config/docs-performance-budget.json has no "${key}" profile. The table and this spec ` +
        `describe the same four load profiles and are meant to be edited together.`
    )
  }
  return entry
}

const DOCS_ORIGIN = `http://localhost:${requireShellPort('E2E_PORT')}`
const AUTHORED_ROUTE = `${DOCS_ORIGIN}/docs/architecture/`

// The three asset families the lazy boundaries are about. Deliberately matched on
// the paths the build actually emits (verified by the budget script, which fails
// if any of them stops being produced) rather than on a chunk id webpack
// reassigns every build.
const CORPUS_MANIFEST = /\/assets\/docs-corpus\/manifest\.v\d+\./
const CORPUS_DOCUMENT = /\/assets\/docs-corpus\/documents\//
const SEARCH_INDEX = /\/search-index\.json/

type Recorder = {
  matching: (pattern: RegExp) => string[]
  /** Bytes of every JS chunk requested since the last `mark()`. */
  chunkBytesSinceMark: () => Promise<number>
  mark: () => void
}

/**
 * Records requests, and can weigh the JS fetched since a marked point.
 *
 * Sizes come from the RESPONSE body rather than a `content-length` header: the
 * preview server may or may not send one, and a budget that silently measures
 * zero is worse than no budget.
 */
const record = (page: Page): Recorder => {
  const entries: { url: string; size: Promise<number> }[] = []
  let index = 0
  page.on('request', (request: Request) => {
    entries.push({
      url: request.url(),
      size: request
        .response()
        .then(async (response) => (response ? (await response.body()).byteLength : 0))
        .catch(() => 0)
    })
  })
  return {
    matching: (pattern) => entries.map((entry) => entry.url).filter((url) => pattern.test(url)),
    mark: () => {
      index = entries.length
    },
    chunkBytesSinceMark: async () => {
      const since = entries.slice(index).filter((entry) => /\.js(\?|$)/.test(entry.url))
      const sizes = await Promise.all(since.map((entry) => entry.size))
      return sizes.reduce((total, size) => total + size, 0)
    }
  }
}

test.describe('documentation assistant load profiles (#481)', () => {
  test('1. reading documentation fetches the manifest and nothing else of the corpus', async ({
    page
  }) => {
    const requests = record(page)
    await installChatMock(page)
    await page.goto(AUTHORED_ROUTE)
    await expect(assistantLauncher(page)).toBeVisible()

    // The manifest IS part of this profile, and that is a deliberate
    // reconciliation rather than a slip: `docs-page-context.tsx` loads it on
    // every route so a navigation into a document resolves immediately instead
    // of opening a fresh `corpus_pending` window at exactly the moment a reader
    // is most likely to ask something. #481's own text placed it at the first
    // read; that wording predates the shipped #474/#476 design.
    //
    // POLLED, not asserted once: the launcher is in the statically rendered
    // HTML, so it is visible before hydration has run — and the manifest is
    // fetched from an effect in `DocsPageProvider`, i.e. strictly afterwards.
    // Reading the count the moment the launcher appears measured a page that had
    // not started yet.
    await expect.poll(() => requests.matching(CORPUS_MANIFEST).length).toBe(1)

    // What must NOT be here: any document body, and the search index. Checked
    // after the manifest has landed, so this is "the corpus settled and pulled
    // nothing else" rather than "nothing has happened yet".
    expect(requests.matching(CORPUS_DOCUMENT)).toEqual([])
    expect(requests.matching(SEARCH_INDEX)).toEqual([])
  })

  test('2. opening the assistant loads the runtime, and still no corpus bodies', async ({
    page
  }) => {
    const requests = record(page)
    await installChatMock(page)
    await page.goto(AUTHORED_ROUTE)
    await expect(assistantLauncher(page)).toBeVisible()
    requests.mark()

    await assistantLauncher(page).click()
    await expect(assistantComposer(page)).toBeVisible({ timeout: 30_000 })

    const bytes = await requests.chunkBytesSinceMark()
    const budget = profile('assistantRuntime')
    // Printed unconditionally: this is the profile whose baseline the table says
    // is a ceiling rather than a measurement, and a run nobody can read the
    // actual number from is a baseline nobody can ever tighten.
    console.log(`[#481] assistantRuntime: ${bytes.toLocaleString('en-US')} bytes fetched`)
    expect(bytes).toBeGreaterThan(0)
    expect(bytes, budget.note).toBeLessThanOrEqual(budget.maxBytes)

    // The whole point of a separate profile: activating the assistant is not
    // reading documentation. Opening it must not pull a single document body.
    expect(requests.matching(CORPUS_DOCUMENT)).toEqual([])
    expect(requests.matching(SEARCH_INDEX)).toEqual([])
  })

  test('3. a read fetches exactly one document artifact, and no search index', async ({ page }) => {
    const requests = record(page)
    // Drives the real `read_current_doc` through the runtime's tool path, so the
    // fetch under test is the corpus artifact store's own, not a test double's.
    const mock = await installAppToolMock(page, 'read_current_doc', {})
    await page.goto(AUTHORED_ROUTE)
    await assistantLauncher(page).click()
    await expect(assistantComposer(page)).toBeVisible({ timeout: 30_000 })
    await dismissTelemetryDialog(page)
    // The assistant discloses what a send does before the first one (issue
    // #481); acknowledging it is what lets this run reach a tool at all.
    await sendAssistantPrompt(page, 'Summarize this page.')

    await expect(page.getByText(SYNTHESIS_ANSWER)).toBeVisible({ timeout: 30_000 })

    // ONE artifact — not the corpus.
    expect(requests.matching(CORPUS_DOCUMENT)).toHaveLength(1)

    // …and it was the right document. Asserted on the tool's own returned `ref`
    // rather than on the artifact's filename: the file is content-addressed and
    // case-folded (`current-architecture-architecture.<hash>.<hash>.json`), so a
    // filename match would be asserting the build's naming scheme, not that the
    // reader got an answer about the page they were on.
    const result = toolResultFor(mock, 'read_current_doc') as
      | { status?: string; doc?: { ref?: string } }
      | undefined
    expect(result?.status).toBe('ok')
    expect(result?.doc?.ref).toBe('architecture/ARCHITECTURE')

    // Reading is not searching.
    expect(requests.matching(SEARCH_INDEX)).toEqual([])
  })

  test('4. a search loads the Lunr index only at that point', async ({ page }) => {
    const requests = record(page)
    await installAppToolMock(page, 'search_docs', { query: 'plugin infrastructure' })
    await page.goto(AUTHORED_ROUTE)
    await assistantLauncher(page).click()
    await expect(assistantComposer(page)).toBeVisible({ timeout: 30_000 })
    await dismissTelemetryDialog(page)

    // Nothing so far may have touched the index.
    expect(requests.matching(SEARCH_INDEX)).toEqual([])
    requests.mark()

    await sendAssistantPrompt(page, 'Where can I find the plugin documentation?')
    await expect(page.getByText(SYNTHESIS_ANSWER)).toBeVisible({ timeout: 30_000 })

    // Finding the index here is also the production-build smoke check: the
    // upstream plugin writes `search-index.json` only from its `postBuild` hook,
    // so a build that stopped emitting it would leave search permanently
    // unavailable on the deployed site while every unit test stayed green.
    const indexes = requests.matching(SEARCH_INDEX)
    expect(indexes.length).toBeGreaterThan(0)

    const budget = profile('search')
    const maxWorkerBytes = budget.maxWorkerBytes
    expect(maxWorkerBytes, 'the search profile must declare maxWorkerBytes').toBeDefined()
    const bytes = await requests.chunkBytesSinceMark()
    console.log(`[#481] search worker chunks: ${bytes.toLocaleString('en-US')} bytes fetched`)

    // The laziness assertion, and the one that actually matters. If the search
    // worker ever became an eager dependency of the assistant runtime it would
    // already have been fetched during activation, and NOTHING new would arrive
    // here — so a floor of zero is what catches that regression. A cap alone
    // would have passed it, reporting a smaller number and calling it an
    // improvement.
    expect(
      bytes,
      'no JavaScript arrived at first search — the search worker is no longer lazy'
    ).toBeGreaterThan(0)
    expect(bytes, budget.note).toBeLessThanOrEqual(maxWorkerBytes!)

    // Searching is not reading: a search returns pages, and pulling their bodies
    // to answer would defeat the whole point of a separate read tool.
    expect(requests.matching(CORPUS_DOCUMENT)).toEqual([])
  })

  test('a returning reader with the panel open pays the runtime cost, and no more corpus', async ({
    page
  }) => {
    // The second `/docs/` load profile #480's decision 2 created and explicitly
    // handed to this issue to budget. A restored panel downloads the runtime
    // during page load — by the reader's own earlier choice — but must not turn
    // a page view into a corpus fetch.
    await installChatMock(page)
    await page.goto(AUTHORED_ROUTE)
    await assistantLauncher(page).click()
    await expect(assistantComposer(page)).toBeVisible({ timeout: 30_000 })

    const requests = record(page)
    await page.reload()
    await expect(assistantComposer(page)).toBeVisible({ timeout: 30_000 })

    // Polled for the same reason as profile 1: the manifest is fetched from an
    // effect, so the reload's composer can be back before it lands.
    await expect.poll(() => requests.matching(CORPUS_MANIFEST).length).toBe(1)
    expect(requests.matching(CORPUS_DOCUMENT)).toEqual([])
    expect(requests.matching(SEARCH_INDEX)).toEqual([])
  })
})
