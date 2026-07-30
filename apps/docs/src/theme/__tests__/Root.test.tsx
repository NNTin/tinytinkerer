/**
 * The swizzled `@theme/Root` is the only mounting point for the documentation
 * page context, so what it has to get right is small and load-bearing: keep the
 * theme's own Root, and put the provider inside it once, for every route.
 */
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from '@docs-test/react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  __resetDocusaurusGlobalData,
  __setDocusaurusGlobalData
} from '../../test/docusaurus-use-global-data-stub'
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
})
