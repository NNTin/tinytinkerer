/**
 * The streamed-snapshot half of the link policy (issue #478).
 *
 * The documents here are parsed by the assistant's **real** Markdown session
 * (`content-markdown`, the same one the runtime injects), so what is sanitized
 * is exactly what the renderer would have mounted — including the partial
 * snapshots a half-typed link produces mid-stream.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createMarkdownContentSession } from '@tinytinkerer/app-browser/assistant-markdown'
import type { ContentDocument } from '@tinytinkerer/app-browser'
import {
  CANONICAL,
  installDocumentationCorpus,
  resetDocumentationCorpus
} from '../../docs-tools/__tests__/site-artifact-fixture'
import { readerIsNowhere, runTool, SITE } from './real-tool-results'
import { createDocumentationAssistantPolicy } from '../index'
import { REMOVED_LINK_TEXT } from '../answer-links'
import type { AppToolResultRecord } from '@tinytinkerer/app-browser'

const policy = createDocumentationAssistantPolicy({
  getSiteConfig: () => SITE.siteConfig,
  getOrigin: () => SITE.origin
})

const parse = (markdown: string): ContentDocument =>
  createMarkdownContentSession(markdown).snapshot().document

const sanitizerFor = (results: AppToolResultRecord[]) => policy.prepareRenderedContent!({ results })

const sanitize = (markdown: string, results: AppToolResultRecord[]): ContentDocument =>
  sanitizerFor(results)(parse(markdown))

/**
 * Every `href` the renderer would mount. Structural on purpose: this is the
 * assertion side, so it must not share the policy's own idea of where links can
 * hide — a node type the policy forgot to visit is exactly what it should catch.
 */
const hrefs = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.flatMap(hrefs)
  }
  if (typeof value !== 'object' || value === null) {
    return []
  }
  const node = value as { type?: unknown; url?: unknown }
  const own = node.type === 'link' && typeof node.url === 'string' ? [node.url] : []
  return [...own, ...Object.values(value).flatMap(hrefs)]
}

const text = (document: ContentDocument): string => JSON.stringify(document)

describe('rendered link policy', () => {
  beforeEach(() => installDocumentationCorpus())
  afterEach(() => {
    resetDocumentationCorpus()
    readerIsNowhere()
  })

  const authorized = () => runTool('read_doc', { ref: CANONICAL.entry.ref })

  it('keeps an authorized documentation link clickable', async () => {
    const document = sanitize(`See [it](${CANONICAL.entry.permalink}).`, [await authorized()])
    expect(hrefs(document.nodes)).toContain(CANONICAL.entry.permalink)
  })

  it('returns the document by identity when nothing needs changing', async () => {
    const results = [await authorized()]
    const parsed = parse(`See [it](${CANONICAL.entry.permalink}).`)
    expect(sanitizerFor(results)(parsed)).toBe(parsed)
  })

  it('strips an unauthorized documentation link while keeping its text', async () => {
    const document = sanitize('Read [the API reference](/docs/api-reference/).', [
      await authorized()
    ])

    expect(hrefs(document.nodes)).toEqual([])
    expect(text(document)).toContain('the API reference')
  })

  it('replaces a bare fabricated URL rather than leaving it visible as prose', async () => {
    const document = sanitize(`Read ${SITE.origin}/docs/api-reference/ for details.`, [
      await authorized()
    ])

    expect(hrefs(document.nodes)).toEqual([])
    expect(text(document)).toContain(REMOVED_LINK_TEXT)
    expect(text(document)).not.toContain('/docs/api-reference/')
  })

  it('never leaves a fabricated link clickable mid-stream', async () => {
    const results = [await authorized()]
    const answer = `Read [the API reference](/docs/api-reference/) and [this](${CANONICAL.entry.permalink}).`
    const session = createMarkdownContentSession('')
    // Compiled ONCE, then applied per snapshot — the shape the host uses.
    const sanitizer = sanitizerFor(results)

    // Every prefix of the streamed answer, i.e. every snapshot the renderer
    // would have been handed while the model was typing.
    for (const character of answer) {
      const snapshot = session.append(character)
      expect(hrefs(sanitizer(snapshot.document).nodes)).not.toContain('/docs/api-reference/')
    }

    // …and the authorized one survives to the end.
    expect(hrefs(sanitizer(session.snapshot().document).nodes)).toContain(CANONICAL.entry.permalink)
  })

  it('leaves a documentation URL inside a code block alone', async () => {
    const markdown = ['```md', '[docs](/docs/invented/)', '```'].join('\n')
    const parsed = parse(markdown)
    expect(sanitizerFor([await authorized()])(parsed)).toBe(parsed)
  })

  it('sanitizes inside lists, blockquotes, and tables', async () => {
    const markdown = [
      '- [a](/docs/invented-a/)',
      '',
      '> [b](/docs/invented-b/)',
      '',
      '| P |',
      '| --- |',
      '| [c](/docs/invented-c/) |'
    ].join('\n')

    const document = sanitize(markdown, [await authorized()])
    expect(hrefs(document.nodes)).toEqual([])
    const serialized = text(document)
    expect(serialized).not.toContain('/docs/invented-a/')
    expect(serialized).not.toContain('/docs/invented-b/')
    expect(serialized).not.toContain('/docs/invented-c/')
  })

  it('governs nothing when no documentation tool has succeeded yet', () => {
    // A conversation with no results authorizes nothing, so every documentation
    // link in it is fabricated as far as this policy can tell.
    const document = sanitize(`See [it](${CANONICAL.entry.permalink}).`, [])
    expect(hrefs(document.nodes)).toEqual([])
  })
})
