/**
 * The non-React reader of the #476 context (page-snapshot.ts), including the
 * property that makes it safe for a tool to answer from: it publishes only
 * resolutions React actually committed, and it publishes the same value the
 * hook returns.
 */
import { useLayoutEffect } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, render, waitFor } from '@testing-library/react'
import { MemoryRouter, useHistory } from '@docs-test/react-router-dom'
// Typed, unlike the test-only react-router sliver, and the very hook the
// provider itself routes on — so the probe re-renders on exactly the renders
// the provider does.
import { useLocation } from '@docusaurus/router'
import { DocsPageProvider, useDocsPageContext } from '../docs-page-context'
import {
  awaitDocsPageSnapshot,
  publishDocsPageSnapshot,
  readDocsPageSnapshot,
  resetDocsPageSnapshotForTests,
  subscribeDocsPageSnapshot,
  type DocsPageSnapshotInput
} from '../page-snapshot'
import { __resetGlobalData } from '../../test/generated-global-data-stub'
import {
  __resetDocusaurusGlobalData,
  __setDocusaurusGlobalData
} from '../../test/docusaurus-use-global-data-stub'
import { resetDocumentationCorpusStoreForTests } from '../../docs-corpus/manifest-store'
import { SITE_CONFIG, siteGlobalData } from './site-corpus-fixture'
import { asPublication } from './publication-fixture'

const snapshot = (pathname: string): DocsPageSnapshotInput =>
  asPublication({
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

    it('is published during commit, before any passive effect can run', async () => {
      __setDocusaurusGlobalData('docusaurus-plugin-content-docs', 'default', siteGlobalData())
      vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')))

      let navigate: (to: string) => void = () => {
        throw new Error('navigate used before render')
      }
      const Navigator = () => {
        const history = useHistory()
        navigate = (to) => history.push(to)
        return null
      }

      // Rendered as a *later sibling* of the provider, reading in its own layout
      // effect. React runs layout effects in tree order, so this one runs after
      // the provider's and before any passive effect in the tree — which is
      // precisely the window a tool call can land in when the reader navigates
      // mid-turn (#481's "navigation while a tool call is in flight").
      //
      // With a passive publish this records the *previous* route; only a
      // commit-synchronous publish makes it record the destination.
      const seenDuringCommit: (string | undefined)[] = []
      const CommitProbe = () => {
        // A router consumer, so it re-renders on navigation: react-router hands
        // `<Router>` the same children element on every render, and React bails
        // out of re-rendering a component whose element is identical.
        useLocation()
        useLayoutEffect(() => {
          seenDuringCommit.push(readDocsPageSnapshot()?.pathname)
        })
        return null
      }

      render(
        <MemoryRouter initialEntries={['/docs/architecture/packages-concept/']}>
          <Navigator />
          <DocsPageProvider>
            <span />
          </DocsPageProvider>
          <CommitProbe />
        </MemoryRouter>
      )
      await waitFor(() => {
        expect(readDocsPageSnapshot()).toBeDefined()
      })
      const before = readDocsPageSnapshot()
      seenDuringCommit.length = 0

      act(() => {
        navigate('/docs/updates/PRIVACY-UPDATE/')
      })

      expect(seenDuringCommit.at(-1)).toBe('/docs/updates/PRIVACY-UPDATE/')
      expect(readDocsPageSnapshot()?.revision).toBeGreaterThan(before?.revision ?? 0)
    })
  })

  describe('revisions', () => {
    it('advances on every publication, including an equal-looking republish', () => {
      // What a failed corpus retry produces: the same values, a new publication.
      // Only the revision can tell a consumer that its retry was answered.
      publishDocsPageSnapshot(snapshot('/docs/a/'))
      const first = readDocsPageSnapshot()?.revision ?? 0
      publishDocsPageSnapshot(snapshot('/docs/a/'))
      const second = readDocsPageSnapshot()?.revision ?? 0

      expect(second).toBeGreaterThan(first)
    })

    it("resets its counter between tests, so none can inherit another's revisions", () => {
      publishDocsPageSnapshot(snapshot('/docs/a/'))
      expect(readDocsPageSnapshot()?.revision).toBe(1)
    })
  })
})
