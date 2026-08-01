// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { fireEvent, renderHook, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

/**
 * The surface-supplied starter override (issue #480).
 *
 * `BrowserApp.starterPrompts` is fixed at construction, which is fine for a shell
 * whose useful suggestions never change and wrong for the documentation
 * assistant, where they depend on which route the reader is on. This is the seam:
 * a surface may replace the app's own prompts, and everything derived after them
 * — plugin, MCP and generic suggestions — is untouched.
 */
import {
  AppBrowserProvider,
  ConversationEmptyState,
  createBrowserApp,
  type BrowserApp
} from '../src/index.js'
import { useStarterPrompts } from '../src/conversation-empty-state.js'

vi.mock('../src/plugins/registry.js', () => ({ loadPluginModules: () => Promise.resolve([]) }))

const app: BrowserApp = createBrowserApp(
  { storageNamespace: 'tinytinkerer-starters-test' },
  { starterPrompts: ['Route-neutral question.'] }
)

const wrapper = ({ children }: { children: ReactNode }) => (
  <AppBrowserProvider app={app}>{children}</AppBrowserProvider>
)

const GENERIC_FILLER = 'Explain a concept in simple terms.'

describe('useStarterPrompts', () => {
  it('uses the app"s own prompts when no override is given', () => {
    const { result } = renderHook(() => useStarterPrompts(), { wrapper })
    expect(result.current[0]).toBe('Route-neutral question.')
  })

  it('puts an override first and drops the app"s own', () => {
    const { result } = renderHook(() => useStarterPrompts(['Summarize this page.']), { wrapper })

    expect(result.current[0]).toBe('Summarize this page.')
    expect(result.current).not.toContain('Route-neutral question.')
    // Everything downstream still applies: an override narrows the app's list,
    // not the derivation.
    expect(result.current).toContain(GENERIC_FILLER)
  })
})

describe('ConversationEmptyState', () => {
  it('shows `count` suggestions from the override, and fills rather than sends', () => {
    const onSelectPrompt = vi.fn()
    render(
      <AppBrowserProvider app={app}>
        <ConversationEmptyState
          count={3}
          starterPrompts={['Summarize this page.', 'Explain a section of this page.']}
          onSelectPrompt={onSelectPrompt}
        />
      </AppBrowserProvider>
    )

    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(3)
    expect(buttons[0]).toHaveTextContent('Summarize this page.')
    expect(buttons[1]).toHaveTextContent('Explain a section of this page.')

    // The reader keeps the chance to edit before anything reaches a model —
    // which is what #481's pre-send disclosure depends on.
    fireEvent.click(buttons[0] as HTMLElement)
    expect(onSelectPrompt).toHaveBeenCalledWith('Summarize this page.')
  })
})
