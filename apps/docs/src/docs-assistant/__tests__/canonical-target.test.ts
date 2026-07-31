/**
 * The one URL-identity contract both link passes share (issue #478).
 *
 * A table rather than prose cases: this function decides what "the same
 * documentation page" means, and both the finalizer and the renderer act on its
 * answer, so every shape a link can arrive in belongs in one place where the
 * boundary is visible.
 */
import { describe, expect, it } from 'vitest'
import { classifyDocumentationLink, type DocumentationSite } from '../canonical-target'

const SITE: DocumentationSite = {
  siteConfig: { baseUrl: '/docs/', trailingSlash: true },
  origin: 'https://tiny.example'
}

/** A deploy preview serves the documentation under a nested base path. */
const PREVIEW: DocumentationSite = {
  siteConfig: { baseUrl: '/pr-1/docs/', trailingSlash: true },
  origin: 'https://preview.example'
}

type Expectation = 'documentation' | 'outside-policy' | 'unresolvable'

const cases: readonly [string, string, Expectation, string?][] = [
  // [description, url, kind, canonical document]
  ['a relative path', '/docs/architecture/x/', 'documentation', '/docs/architecture/x/'],
  [
    'a relative path without the trailing slash',
    '/docs/architecture/x',
    'documentation',
    '/docs/architecture/x/'
  ],
  ['the documentation root itself', '/docs/', 'documentation', '/docs/'],
  ['the documentation root without its slash', '/docs', 'documentation', '/docs/'],
  ['a same-origin absolute URL', 'https://tiny.example/docs/x/', 'documentation', '/docs/x/'],
  ['a same-origin protocol-relative URL', '//tiny.example/docs/x/', 'documentation', '/docs/x/'],
  ['a bare relative path', 'architecture/x', 'documentation', '/docs/architecture/x/'],
  ['an anchor-only fragment on a page', '/docs/x/#intro', 'documentation', '/docs/x/'],
  ['a foreign absolute URL', 'https://docusaurus.io/docs/x', 'outside-policy'],
  ['a foreign protocol-relative URL', '//evil.example/docs/x/', 'outside-policy'],
  ['a non-web scheme', 'mailto:hi@example.test', 'outside-policy'],
  ['a javascript: URL', 'javascript:alert(1)', 'outside-policy'],
  ['a product route outside the documentation', '/pricing/', 'outside-policy'],
  ['a path that merely shares the base prefix', '/docs-evil/x/', 'outside-policy'],
  ['another path sharing the base prefix', '/docsomething', 'outside-policy'],
  ['an empty URL', '', 'unresolvable'],
  ['a whitespace-only URL', '   ', 'unresolvable']
]

describe('classifyDocumentationLink', () => {
  for (const [description, url, kind, document] of cases) {
    it(`classifies ${description} as ${kind}`, () => {
      const result = classifyDocumentationLink(url, SITE)
      expect(result.kind).toBe(kind)
      if (result.kind === 'documentation' && document) {
        expect(result.target.document).toBe(document)
      }
    })
  }

  it('scopes to a nested base path under a deploy preview', () => {
    expect(classifyDocumentationLink('/pr-1/docs/x/', PREVIEW)).toMatchObject({
      kind: 'documentation',
      target: { document: '/pr-1/docs/x/', anchor: null }
    })
    // The un-prefixed path is a different site's route under this deployment.
    expect(classifyDocumentationLink('/docs/x/', PREVIEW).kind).toBe('outside-policy')
  })

  it('treats an absolute URL as foreign when the site origin is unknown', () => {
    const headless = { ...SITE, origin: null }
    expect(classifyDocumentationLink('https://tiny.example/docs/x/', headless).kind).toBe(
      'outside-policy'
    )
    // A path is still judgeable without an origin, so it stays governed.
    expect(classifyDocumentationLink('/docs/x/', headless).kind).toBe('documentation')
  })

  it('reports a query string rather than folding it into the target', () => {
    const result = classifyDocumentationLink('/docs/x/?utm=1#intro', SITE)
    expect(result).toMatchObject({
      kind: 'documentation',
      hasQuery: true,
      target: { document: '/docs/x/', anchor: 'intro' }
    })
  })

  it('decodes a percent-encoded anchor so both spellings are one target', () => {
    expect(classifyDocumentationLink('/docs/x/#%C3%BCber', SITE)).toMatchObject({
      target: { anchor: 'über' }
    })
  })
})
