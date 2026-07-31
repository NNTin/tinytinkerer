/**
 * What the answer owes, and what the footer therefore says (issue #478).
 *
 * These assertions go through `createDocumentationAssistantPolicy().finalizeAnswer`
 * — the very function the runtime calls — rather than the pieces underneath it,
 * because the ordering between demotion, citation detection, and the footer is
 * itself load-bearing: an unauthorized link must not be able to settle an
 * obligation on its way to being removed.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  CANONICAL,
  installDocumentationCorpus,
  LANDING,
  OVERSIZED,
  resetDocumentationCorpus
} from '../../docs-tools/__tests__/site-artifact-fixture'
import {
  firstAnchorOf,
  readerIsNowhere,
  readerIsOn,
  runTool,
  searchDocumentation,
  searchResponseOf,
  SITE
} from './real-tool-results'
import { createDocumentationAssistantPolicy } from '../index'
import type { AppToolResultRecord } from '@tinytinkerer/app-browser'

const policy = createDocumentationAssistantPolicy({
  getSiteConfig: () => SITE.siteConfig,
  getOrigin: () => SITE.origin
})

const finalize = async (source: string, results: AppToolResultRecord[]): Promise<string> =>
  policy.finalizeAnswer!({ source, results })

describe('the Sources footer', () => {
  beforeEach(() => {
    installDocumentationCorpus()
    searchDocumentation.mockReset()
  })
  afterEach(() => {
    resetDocumentationCorpus()
    readerIsNowhere()
  })

  it('adds the document a cross-page read used when the answer cites nothing', async () => {
    const answer = await finalize('Packages may depend downwards only.', [
      await runTool('read_doc', { ref: CANONICAL.entry.ref })
    ])

    expect(answer).toContain('**Sources**')
    expect(answer).toContain(`- [${CANONICAL.entry.title}](${CANONICAL.entry.permalink})`)
  })

  it('adds nothing when the model already cited that document inline', async () => {
    const source = `See [Packages Concept](${CANONICAL.entry.permalink}) for the rules.`
    const answer = await finalize(source, [await runTool('read_doc', { ref: CANONICAL.entry.ref })])

    expect(answer).toBe(source)
  })

  it('accepts a base-page citation for a section that was read, without adding a second link', async () => {
    const anchor = firstAnchorOf(CANONICAL)
    const source = `As described on [that page](${CANONICAL.entry.permalink}).`
    const answer = await finalize(source, [
      await runTool('read_doc', { ref: CANONICAL.entry.ref, anchor })
    ])

    expect(answer).toBe(source)
  })

  it('generates the most specific target it has', async () => {
    const anchor = firstAnchorOf(CANONICAL)
    const answer = await finalize('That section explains it.', [
      await runTool('read_doc', { ref: CANONICAL.entry.ref, anchor })
    ])

    expect(answer).toContain(`](${CANONICAL.entry.permalink}#${anchor})`)
  })

  it('lists only the documents still missing a citation', async () => {
    const source = `Covered on [one page](${CANONICAL.entry.permalink}).`
    const answer = await finalize(source, [
      await runTool('read_doc', { ref: CANONICAL.entry.ref }),
      await runTool('read_doc', { ref: LANDING.entry.ref })
    ])

    expect(answer).toContain(`- [${LANDING.entry.title}](${LANDING.entry.permalink})`)
    expect(answer).not.toContain(`- [${CANONICAL.entry.title}]`)
  })

  it('cites one search result, not every result the search returned', async () => {
    searchDocumentation.mockResolvedValue(searchResponseOf(CANONICAL, LANDING, OVERSIZED))
    const answer = await finalize('The packages guide covers it.', [
      await runTool('search_docs', { query: 'packages' })
    ])

    // `LANDING.entry.permalink` is `/docs/`, a prefix of every other permalink,
    // so the assertion is on the rendered entries rather than on a substring.
    expect(answer).toContain(`- [${CANONICAL.entry.title}](${CANONICAL.entry.permalink})`)
    expect(answer.match(/^- \[/gm)).toHaveLength(1)
  })

  it('adds no search footer once the model cites a result it was shown', async () => {
    searchDocumentation.mockResolvedValue(searchResponseOf(CANONICAL, LANDING))
    const source = `The [landing page](${LANDING.entry.permalink}) covers it.`
    const answer = await finalize(source, [await runTool('search_docs', { query: 'packages' })])

    expect(answer).toBe(source)
  })

  it('lets a current-page summary finish with no citation at all', async () => {
    readerIsOn(CANONICAL)
    const source = 'This page explains how packages may depend on one another.'
    const answer = await finalize(source, [await runTool('read_current_doc', {})])

    expect(answer).toBe(source)
  })

  it('still cites a cross-page read made alongside a current-page read', async () => {
    readerIsOn(CANONICAL)
    const answer = await finalize('Both pages agree.', [
      await runTool('read_current_doc', {}),
      await runTool('read_doc', { ref: LANDING.entry.ref })
    ])

    expect(answer).toContain(`- [${LANDING.entry.title}](${LANDING.entry.permalink})`)
    expect(answer).not.toContain(`- [${CANONICAL.entry.title}]`)
  })

  it('does not let a fabricated link suppress the citation that should replace it', async () => {
    const answer = await finalize('Covered in [the guide](/docs/invented/).', [
      await runTool('read_doc', { ref: CANONICAL.entry.ref })
    ])

    expect(answer).toContain('Covered in the guide.')
    expect(answer).toContain(`- [${CANONICAL.entry.title}](${CANONICAL.entry.permalink})`)
  })

  it('adds nothing at all when no documentation tool succeeded', async () => {
    const source = 'I could not reach the documentation.'
    expect(await finalize(source, [])).toBe(source)
  })

  it('renders a list, so a two-source footer is not two link-preview cards', async () => {
    const answer = await finalize('Two pages cover this.', [
      await runTool('read_doc', { ref: CANONICAL.entry.ref }),
      await runTool('read_doc', { ref: LANDING.entry.ref })
    ])

    expect(answer.trimEnd().endsWith(`](${LANDING.entry.permalink})`)).toBe(true)
    expect(answer).toMatch(/\n\*\*Sources\*\*\n\n- \[/)
  })
})
