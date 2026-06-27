import { describe, expect, it } from 'vitest'
import { resolveSiblingAppUrl } from '../src/app-url'

describe('resolveSiblingAppUrl', () => {
  it('resolves root and nested deployment siblings', () => {
    expect(resolveSiblingAppUrl('/canvas/', 'excalidraw-app')).toBe('/excalidraw-app/')
    expect(resolveSiblingAppUrl('/tinytinkerer/canvas/', '/excalidraw-app/')).toBe(
      '/tinytinkerer/excalidraw-app/'
    )
  })

  it('rejects ambiguous relative or empty paths', () => {
    expect(() => resolveSiblingAppUrl('canvas/', 'excalidraw-app')).toThrow()
    expect(() => resolveSiblingAppUrl('/canvas/', '')).toThrow()
  })
})
