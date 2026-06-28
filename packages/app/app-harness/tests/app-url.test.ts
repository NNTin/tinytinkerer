import { describe, expect, it } from 'vitest'
import { resolveEmbeddedAppUrl } from '../src/app-url'

describe('resolveEmbeddedAppUrl', () => {
  it('resolves root and nested deployment children', () => {
    expect(resolveEmbeddedAppUrl('/canvas/', 'excalidraw-app')).toBe('/canvas/excalidraw-app/')
    expect(resolveEmbeddedAppUrl('/tinytinkerer/canvas/', '/excalidraw-app/')).toBe(
      '/tinytinkerer/canvas/excalidraw-app/'
    )
  })

  it('rejects ambiguous relative or empty paths', () => {
    expect(() => resolveEmbeddedAppUrl('canvas/', 'excalidraw-app')).toThrow()
    expect(() => resolveEmbeddedAppUrl('/canvas', 'excalidraw-app')).toThrow()
    expect(() => resolveEmbeddedAppUrl('/canvas/', '')).toThrow()
  })
})
