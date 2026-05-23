import { describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { brandDefinitionSchema } from '@tinytinkerer/contracts'
import { TINYTINKERER_BRAND, TINYTINKERER_BRAND_ASSET_URLS } from '../src/index.js'

describe('brand assets', () => {
  it('exports placeholder brand data matching shared contracts', () => {
    expect(brandDefinitionSchema.parse(TINYTINKERER_BRAND).theme.applicationName).toBe(
      'tinytinkerer'
    )
  })

  it('exports generated PNG asset URLs for browser branding', () => {
    expect(TINYTINKERER_BRAND.links.map((link) => link.href)).toContain(
      TINYTINKERER_BRAND_ASSET_URLS.faviconIco
    )
    expect(TINYTINKERER_BRAND.links.map((link) => link.href)).toContain(
      TINYTINKERER_BRAND_ASSET_URLS.appleTouchIcon180
    )
    expect(TINYTINKERER_BRAND.manifest.icons.map((icon) => icon.src)).toContain(
      TINYTINKERER_BRAND_ASSET_URLS.iconMaskable512
    )
  })

  it('keeps the source image and future mobile icon files in the package', () => {
    expect(existsSync(new URL('../assets/source/tinytinkerer.jpg', import.meta.url))).toBe(true)
    expect(existsSync(new URL('../assets/generated/favicon.ico', import.meta.url))).toBe(true)
    expect(existsSync(new URL('../assets/generated/icon-1024.png', import.meta.url))).toBe(true)
  })
})
