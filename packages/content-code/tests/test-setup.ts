import '@testing-library/jest-dom/vitest'

const noop = () => undefined

const buildRect = (): DOMRect => ({
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  toJSON: () => ({})
})

const buildRectList = (): DOMRectList => {
  const list = [] as unknown as DOMRectList
  ;(list as unknown as { item: (index: number) => DOMRect | null }).item = () => null
  return list
}

if (typeof window !== 'undefined') {
  if (!window.matchMedia) {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: () => ({
        matches: false,
        media: '',
        onchange: null,
        addListener: noop,
        removeListener: noop,
        addEventListener: noop,
        removeEventListener: noop,
        dispatchEvent: () => false
      })
    })
  }
  if (!('IntersectionObserver' in window)) {
    class IO {
      readonly root = null
      readonly rootMargin = ''
      readonly thresholds: readonly number[] = []
      observe = noop
      unobserve = noop
      disconnect = noop
      takeRecords = (): IntersectionObserverEntry[] => []
    }
    Object.defineProperty(window, 'IntersectionObserver', {
      configurable: true,
      value: IO
    })
  }
  if (!('ResizeObserver' in window)) {
    class RO {
      observe = noop
      unobserve = noop
      disconnect = noop
    }
    Object.defineProperty(window, 'ResizeObserver', {
      configurable: true,
      value: RO
    })
  }
}

if (typeof Range !== 'undefined') {
  Range.prototype.getBoundingClientRect = buildRect
  Range.prototype.getClientRects = buildRectList
}

if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = noop
}

if (typeof document !== 'undefined' && !document.elementFromPoint) {
  ;(document as unknown as { elementFromPoint: () => null }).elementFromPoint = () => null
}
