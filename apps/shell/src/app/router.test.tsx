import { describe, expect, it, vi } from 'vitest'

const createHashRouter = vi.fn(() => ({ mode: 'hash-router' }))

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return {
    ...actual,
    createHashRouter
  }
})

describe('shell router', () => {
  it('uses hash routing for GitHub Pages compatibility', async () => {
    // Import lazily (after the mock applies) so the module's react-router-dom import
    // resolves to the mock rather than tripping the hoisted-factory TDZ.
    const { createShellRouter } = await import('./router.js')
    const { resolvePresentation } = await import('../presentations.js')

    const router = createShellRouter(resolvePresentation('/web/'))

    expect(createHashRouter).toHaveBeenCalledTimes(1)
    expect(router).toEqual({ mode: 'hash-router' })
  })
})
