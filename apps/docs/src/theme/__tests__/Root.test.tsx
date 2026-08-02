/**
 * The swizzled `@theme/Root` is the only mounting point for the documentation
 * page context, so what it has to get right is small and load-bearing: keep the
 * theme's own Root, and put the provider inside it once, for every route.
 */
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from '@docs-test/react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  __resetDocusaurusGlobalData,
  __setDocusaurusGlobalData
} from '../../test/docusaurus-use-global-data-stub'
import {
  __resetSiteConfig,
  __setSiteConfig
} from '../../test/docusaurus-use-docusaurus-context-stub'
import { useDocsPageContext } from '../../docs-page'
import Root from '../Root'
import { siteGlobalData } from '../../docs-page/__tests__/site-corpus-fixture'

const DOCS_GLOBAL_DATA = siteGlobalData()

const Probe = () => <output data-testid="probe">{useDocsPageContext().pathname}</output>

describe('theme/Root', () => {
  beforeEach(() => {
    __setDocusaurusGlobalData('docusaurus-plugin-content-docs', 'default', DOCS_GLOBAL_DATA)
  })

  afterEach(() => {
    __resetDocusaurusGlobalData()
    __resetSiteConfig()
  })

  it('renders children through the theme original Root, inside the docs page provider', () => {
    render(
      <MemoryRouter initialEntries={['/docs/architecture/packages-concept/']}>
        <Root>
          <Probe />
        </Root>
      </MemoryRouter>
    )

    // Wrapping, not replacing: whatever the active theme puts in its own Root
    // has to keep working.
    expect(screen.getByTestId('theme-original-root')).toContainElement(screen.getByTestId('probe'))
    expect(screen.getByTestId('probe')).toHaveTextContent('/docs/architecture/packages-concept/')
  })

  it('mounts the assistant overlay root and the page region alongside the page', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/docs/architecture/packages-concept/']}>
        <Root>
          <p>documentation</p>
        </Root>
      </MemoryRouter>
    )

    expect(container.querySelector('.docs-assistant-root')).not.toBeNull()
    expect(screen.getByText('documentation')).toBeInTheDocument()
  })

  // Issue #481's rollback switch, at the one place it is honoured. What matters
  // is that it removes the whole integration rather than only the visible
  // widget: no provider, no page-inset region, no overlay root, and — because
  // the provider is what loads it — no corpus-manifest request.
  describe('with the assistant rolled back', () => {
    beforeEach(() => {
      __setSiteConfig({ customFields: { tinyDocsAssistantEnabled: false } })
    })

    it('renders an ordinary Docusaurus page with no assistant integration', () => {
      const { container } = render(
        <MemoryRouter initialEntries={['/docs/architecture/packages-concept/']}>
          <Root>
            <p>documentation</p>
          </Root>
        </MemoryRouter>
      )

      // The documentation itself is untouched, still inside the theme's own Root.
      expect(screen.getByTestId('theme-original-root')).toContainElement(
        screen.getByText('documentation')
      )
      expect(container.querySelector('.docs-assistant-root')).toBeNull()
      expect(container.querySelector('.docs-assistant-page')).toBeNull()
    })

    it('does not provide the docs page context, so nothing loads the corpus', () => {
      // `useDocsPageContext` throws outside its provider by design, which is the
      // observable proof that the provider is genuinely absent rather than
      // mounted-but-idle. Errors during render are noisy; the console is
      // silenced for the assertion alone.
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
      expect(() =>
        render(
          <MemoryRouter initialEntries={['/docs/architecture/packages-concept/']}>
            <Root>
              <Probe />
            </Root>
          </MemoryRouter>
        )
      ).toThrow(/useDocsPageContext must be used inside/)
      consoleError.mockRestore()
    })
  })
})
