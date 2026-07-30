// @vitest-environment node
/**
 * Static rendering and hydration safety for the docs page context (issue #476).
 *
 * This file deliberately runs in the **node** environment, with no jsdom: there
 * is no `window`, no `document`, and no `fetch`. That is the closest thing to
 * Docusaurus' own static render a unit test can be, and it turns "must not
 * require window or document access" into something a machine checks rather
 * than something a reviewer eyeballs.
 *
 * It also pins the source-level rule behind that: nothing in this directory may
 * read the rendered page. Identity comes from Docusaurus routing data and the
 * #474 corpus manifest — never from headings, prose, metadata, or ids in the
 * DOM.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { renderToString } from 'react-dom/server'
import { StaticRouter } from '@docs-test/react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import { __setDocusaurusGlobalData } from '../../test/docusaurus-use-global-data-stub'
import Root from '../../theme/Root'
import { useDocsPageContext } from '../docs-page-context'
import { siteGlobalData } from './site-corpus-fixture'

const docsGlobalData = siteGlobalData()

const Probe = () => {
  const { pathname, active } = useDocsPageContext()
  return (
    <output>{`${pathname} → ${active.status === 'document' ? active.document.ref : active.reason}`}</output>
  )
}

describe('static rendering', () => {
  beforeEach(() => {
    __setDocusaurusGlobalData('docusaurus-plugin-content-docs', 'default', docsGlobalData)
  })

  it('renders the Root wrapper without a window, a document, or a network request', () => {
    expect(globalThis.window).toBeUndefined()

    const html = renderToString(
      <StaticRouter location="/docs/architecture/packages-concept/">
        <Root>
          <Probe />
        </Root>
      </StaticRouter>
    )

    // The pathname is already known during the static render; only the corpus
    // manifest is not, and its explicit `corpus_pending` state is exactly what
    // the client's first hydration render produces too — so the two agree and
    // hydration has nothing to reconcile.
    expect(html).toContain('/docs/architecture/packages-concept/ → corpus_pending')
  })

  it('reports a non-document route during static rendering without the corpus', () => {
    const html = renderToString(
      <StaticRouter location="/docs/search/">
        <Root>
          <Probe />
        </Root>
      </StaticRouter>
    )

    expect(html).toContain('/docs/search/ → not_a_document_route')
  })
})

const sourceDirectory = new URL('../', import.meta.url)

const sourceFiles = readdirSync(fileURLToPath(sourceDirectory))
  .filter((name) => name.endsWith('.ts') || name.endsWith('.tsx'))
  .concat('../theme/Root.tsx')

/** Prose explaining why a file must not read the DOM should not trip the check. */
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

describe('no DOM extraction', () => {
  it.each(sourceFiles)('%s never reads the rendered page', (name) => {
    const source = stripComments(
      readFileSync(fileURLToPath(new URL(name, sourceDirectory)), 'utf8')
    )

    expect(source).not.toMatch(/\bwindow\b/)
    // `document` is also an ordinary local name for a corpus entry here, so the
    // check names the global's members rather than the bare identifier.
    expect(source).not.toMatch(/\bdocument\.(title|body|head|getElement|querySelector)/)
    expect(source).not.toMatch(
      /querySelectorAll?|getElementById|getElementsBy|innerText|textContent|innerHTML|outerHTML/
    )
  })
})
