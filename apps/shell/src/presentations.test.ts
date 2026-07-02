import { describe, expect, it } from 'vitest'
import { resolvePresentation, resolvePresentationId } from './presentations'

describe('shell presentation resolution', () => {
  it('selects the presentation from the URL path segments', () => {
    expect(resolvePresentationId('/web/')).toBe('web')
    expect(resolvePresentationId('/widget/')).toBe('widget')
    expect(resolvePresentationId('/mobile/')).toBe('mobile')
  })

  it('matches segments under a deploy sub-path and deep links', () => {
    expect(resolvePresentationId('/tinytinkerer/mobile/')).toBe('mobile')
    expect(resolvePresentationId('/widget/index.html')).toBe('widget')
  })

  it('falls back to web for the root and anything unrecognized', () => {
    expect(resolvePresentationId('/')).toBe('web')
    expect(resolvePresentationId('/canvas/')).toBe('web')
  })

  it('exposes the matching descriptor with the right ChatApp config', () => {
    expect(resolvePresentation('/mobile/').sizeVariant).toBe('mobile')
    expect(resolvePresentation('/mobile/').registersServiceWorker).toBe(true)
    expect(resolvePresentation('/mobile/').supportsInstall).toBe(true)
    expect(resolvePresentation('/web/').registersServiceWorker).toBe(false)
    expect(resolvePresentation('/web/').mode).toBe('sidebar')
    expect(resolvePresentation('/widget/').mode).toBe('floating')
    expect(resolvePresentation('/widget/').supportsInspector).toBe(true)
  })
})
