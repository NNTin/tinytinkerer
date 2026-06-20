// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { InlineSvg, renderInline } from '../src/index.js'

afterEach(() => {
  cleanup()
})

describe('InlineSvg', () => {
  it('mounts sanitized inline SVG', () => {
    const { container } = render(
      <InlineSvg markup='<svg xmlns="http://www.w3.org/2000/svg"><rect width="4" height="4"/></svg>' />
    )
    expect(container.querySelector('[data-tt-inline-svg]')).not.toBeNull()
    expect(container.querySelector('svg')).not.toBeNull()
    expect(container.querySelector('rect')).not.toBeNull()
  })

  it('strips scripts and event handlers from the markup', () => {
    const { container } = render(
      <InlineSvg markup='<svg onload="alert(1)"><script>alert(2)</script><rect/></svg>' />
    )
    expect(container.querySelector('script')).toBeNull()
    const html = container.innerHTML.toLowerCase()
    expect(html).not.toContain('onload')
    expect(html).not.toContain('alert(1)')
    expect(html).not.toContain('alert(2)')
  })
})

describe('renderInline imageInline', () => {
  it('renders a raw SVG inline image as sanitized inline SVG', () => {
    const { container } = render(
      <>
        {renderInline([
          {
            type: 'imageInline',
            url: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"><circle r="2"/></svg>',
            alt: 'icon'
          }
        ])}
      </>
    )
    expect(container.querySelector('[data-tt-inline-svg] svg')).not.toBeNull()
    expect(container.querySelector('circle')).not.toBeNull()
    expect(container.querySelector('img')).toBeNull()
  })

  it('keeps an <img> for ordinary inline image URLs', () => {
    const { container } = render(
      <>{renderInline([{ type: 'imageInline', url: 'https://example.com/a.png', alt: 'a' }])}</>
    )
    expect(container.querySelector('img')).not.toBeNull()
    expect(container.querySelector('[data-tt-inline-svg]')).toBeNull()
  })
})
