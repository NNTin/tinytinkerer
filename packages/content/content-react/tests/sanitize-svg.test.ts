// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { isRawSvgDataUri, rawSvgMarkupFromDataUri, sanitizeSvgMarkup } from '../src/index.js'

describe('sanitizeSvgMarkup', () => {
  it('keeps benign SVG markup intact', () => {
    const out = sanitizeSvgMarkup(
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="red"/></svg>'
    )
    expect(out).toContain('<svg')
    expect(out).toContain('<rect')
    expect(out).toContain('fill="red"')
  })

  it('preserves foreignObject HTML integration points (mermaid node labels)', () => {
    const out = sanitizeSvgMarkup(
      '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div><span>Node label</span></div></foreignObject></svg>'
    )
    expect(out.toLowerCase()).toContain('foreignobject')
    expect(out).toContain('<div>')
    expect(out).toContain('Node label')
  })

  it('strips <script> elements', () => {
    const out = sanitizeSvgMarkup('<svg><script>alert(1)</script><rect/></svg>')
    expect(out).not.toContain('<script')
    expect(out).not.toContain('alert(1)')
  })

  it('strips event-handler attributes (onload, onclick)', () => {
    const out = sanitizeSvgMarkup(
      '<svg onload="alert(1)"><rect onclick="steal()" width="4" height="4"/></svg>'
    )
    expect(out.toLowerCase()).not.toContain('onload')
    expect(out.toLowerCase()).not.toContain('onclick')
    expect(out).not.toContain('alert(1)')
    expect(out).not.toContain('steal()')
  })

  it('removes javascript: hrefs from embedded anchors/use elements', () => {
    const out = sanitizeSvgMarkup('<svg><a href="javascript:alert(1)"><rect/></a></svg>')
    expect(out.toLowerCase()).not.toContain('javascript:')
  })
})

describe('isRawSvgDataUri / rawSvgMarkupFromDataUri', () => {
  it('detects the raw (unencoded) form only', () => {
    expect(isRawSvgDataUri('data:image/svg+xml,<svg width="4"></svg>')).toBe(true)
    expect(isRawSvgDataUri('data:image/svg+xml, <svg></svg>')).toBe(true)
    // base64 and percent-encoded forms are NOT raw inline SVG.
    expect(isRawSvgDataUri('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=')).toBe(false)
    expect(isRawSvgDataUri('data:image/svg+xml,%3Csvg%3E%3C/svg%3E')).toBe(false)
    // unrelated schemes / images.
    expect(isRawSvgDataUri('https://example.com/a.svg')).toBe(false)
    expect(isRawSvgDataUri('data:image/png;base64,iVBOR')).toBe(false)
  })

  it('recovers the raw markup after the comma', () => {
    expect(rawSvgMarkupFromDataUri('data:image/svg+xml,<svg width="4"></svg>')).toBe(
      '<svg width="4"></svg>'
    )
    expect(rawSvgMarkupFromDataUri('no-comma')).toBe('')
  })
})
