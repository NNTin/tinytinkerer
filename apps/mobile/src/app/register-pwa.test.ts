import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type OnRegisteredSW = (
  swUrl: string,
  registration?: ServiceWorkerRegistration
) => void
type RegisterSWOptions = { immediate?: boolean; onRegisteredSW?: OnRegisteredSW }

const registerSW = vi.fn()

vi.mock('virtual:pwa-register', () => ({
  registerSW
}))

const setServiceWorker = (value: unknown) => {
  Object.defineProperty(navigator, 'serviceWorker', {
    value,
    configurable: true
  })
}

const setVisibility = (state: DocumentVisibilityState) => {
  Object.defineProperty(document, 'visibilityState', {
    value: state,
    configurable: true
  })
}

describe('registerPwa', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    registerSW.mockReset()
    setServiceWorker({})
    setVisibility('visible')
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('registers the service worker immediately', async () => {
    const { registerPwa } = await import('./register-pwa.js')
    registerPwa()

    expect(registerSW).toHaveBeenCalledTimes(1)
    expect(registerSW.mock.calls[0]?.[0]).toMatchObject({ immediate: true })
  })

  it('checks for an update when the app returns to the foreground', async () => {
    const { registerPwa } = await import('./register-pwa.js')
    registerPwa()

    const options = registerSW.mock.calls[0]?.[0] as RegisterSWOptions
    const update = vi.fn().mockResolvedValue(undefined)
    options.onRegisteredSW?.('/mobile/sw.js', {
      installing: null,
      update
    } as unknown as ServiceWorkerRegistration)

    setVisibility('visible')
    document.dispatchEvent(new Event('visibilitychange'))

    expect(update).toHaveBeenCalledTimes(1)
  })

  it('does not check for an update while offline', async () => {
    const { registerPwa } = await import('./register-pwa.js')
    registerPwa()

    const options = registerSW.mock.calls[0]?.[0] as RegisterSWOptions
    const update = vi.fn().mockResolvedValue(undefined)
    options.onRegisteredSW?.('/mobile/sw.js', {
      installing: null,
      update
    } as unknown as ServiceWorkerRegistration)

    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))

    expect(update).not.toHaveBeenCalled()
  })

  it('no-ops when service workers are unavailable', async () => {
    setServiceWorker(undefined)
    delete (navigator as { serviceWorker?: unknown }).serviceWorker

    const { registerPwa } = await import('./register-pwa.js')
    registerPwa()

    expect(registerSW).not.toHaveBeenCalled()
  })
})
