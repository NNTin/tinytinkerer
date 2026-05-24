import { describe, expect, it, vi } from 'vitest'

const createHashRouter = vi.fn(() => ({ mode: 'hash-router' }))

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return {
    ...actual,
    createHashRouter
  }
})

describe('web router', () => {
  it('uses hash routing for GitHub Pages compatibility', async () => {
    const module = await import('./router.js')

    expect(createHashRouter).toHaveBeenCalledTimes(1)
    expect(module.router).toEqual({ mode: 'hash-router' })
  })
})
