/**
 * The non-React reader of the #476 context (page-snapshot.ts), including the
 * property that makes it safe for a tool to answer from: it publishes only
 * resolutions React actually committed, and it publishes the same value the
 * hook returns.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { MemoryRouter } from '@docs-test/react-router-dom'
import { DocsPageProvider, useDocsPageContext } from '../docs-page-context'
import {
  awaitDocsPageSnapshot,
  publishDocsPageSnapshot,
  readDocsPageSnapshot,
  resetDocsPageSnapshotForTests,
  subscribeDocsPageSnapshot,
  type DocsPageSnapshot
} from '../page-snapshot'
import { __resetGlobalData } from '../../test/generated-global-data-stub'
import {
  __resetDocusaurusGlobalData,
  __setDocusaurusGlobalData
} from '../../test/docusaurus-use-global-data-stub'
import { resetDocumentationCorpusStoreForTests } from '../../docs-corpus/manifest-store'
import { SITE_CONFIG, siteGlobalData } from './site-corpus-fixture'

const snapshot = (pathname: string): DocsPageSnapshot => ({
  pathname,
  siteConfig: SITE_CONFIG,
  retryCorpus: () => {},
  active: {
    status: 'no-document',
    reason: 'not_a_document_route',
    message: 'no document',
    retryable: false
  }
})

describe('the documentation page snapshot', () => {
  afterEach(() => {
    resetDocsPageSnapshotForTests()
    __resetGlobalData()
    __resetDocusaurusGlobalData()
    resetDocumentationCorpusStoreForTests()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('starts empty, so a reader can tell "not known yet" from "no document"', () => {
    expect(readDocsPageSnapshot()).toBeUndefined()
  })

  it('publishes to current readers and to later ones', () => {
    const seen: string[] = []
    const unsubscribe = subscribeDocsPageSnapshot((value) => seen.push(value.pathname))

    publishDocsPageSnapshot(snapshot('/docs/a/'))
    publishDocsPageSnapshot(snapshot('/docs/b/'))
    unsubscribe()
    publishDocsPageSnapshot(snapshot('/docs/c/'))

    expect(seen).toEqual(['/docs/a/', '/docs/b/'])
    expect(readDocsPageSnapshot()?.pathname).toBe('/docs/c/')
  })

  describe('awaitDocsPageSnapshot', () => {
    it('resolves immediately when the current value already satisfies the predicate', async () => {
      publishDocsPageSnapshot(snapshot('/docs/a/'))
      const result = await awaitDocsPageSnapshot((value) => value.pathname === '/docs/a/', 50)
      expect(result?.pathname).toBe('/docs/a/')
    })

    it('resolves on a later publish', async () => {
      const pending = awaitDocsPageSnapshot((value) => value.pathname === '/docs/b/', 1_000)
      publishDocsPageSnapshot(snapshot('/docs/a/'))
      publishDocsPageSnapshot(snapshot('/docs/b/'))
      expect((await pending)?.pathname).toBe('/docs/b/')
    })

    it('gives up rather than hanging past a tool timeout', async () => {
      vi.useFakeTimers()
      const pending = awaitDocsPageSnapshot(() => false, 4_000)
      await vi.advanceTimersByTimeAsync(4_001)
      expect(await pending).toBeUndefined()
    })

    it('unsubscribes after timing out, so a later publish cannot resolve it twice', async () => {
      vi.useFakeTimers()
      const pending = awaitDocsPageSnapshot(() => false, 100)
      await vi.advanceTimersByTimeAsync(101)
      expect(await pending).toBeUndefined()
      publishDocsPageSnapshot(snapshot('/docs/a/'))
      expect(await pending).toBeUndefined()
    })
  })

  describe('from the provider', () => {
    it('publishes the same resolution the hook returns', async () => {
      __setDocusaurusGlobalData('docusaurus-plugin-content-docs', 'default', siteGlobalData())
      vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')))

      let fromHook: { pathname: string } | undefined
      const Probe = () => {
        fromHook = useDocsPageContext()
        return null
      }
      render(
        <MemoryRouter initialEntries={['/docs/architecture/packages-concept/']}>
          <DocsPageProvider>
            <Probe />
          </DocsPageProvider>
        </MemoryRouter>
      )

      await waitFor(() => {
        expect(readDocsPageSnapshot()).toBeDefined()
      })
      expect(readDocsPageSnapshot()?.pathname).toBe(fromHook?.pathname)
      expect(readDocsPageSnapshot()?.siteConfig).toEqual(SITE_CONFIG)
      expect(typeof readDocsPageSnapshot()?.retryCorpus).toBe('function')
    })
  })
})
