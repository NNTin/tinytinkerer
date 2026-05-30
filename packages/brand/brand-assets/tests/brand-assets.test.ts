import { describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { brandDefinitionSchema } from '@tinytinkerer/contracts'
import {
  LICENSE_TEXT,
  TINYTINKERER_BRAND,
  TINYTINKERER_BRAND_ASSET_URLS,
  TINYTINKERER_SOCIALS
} from '../src/index.js'

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

  it('exposes the brand social links', () => {
    expect(TINYTINKERER_SOCIALS.map((social) => social.kind)).toEqual([
      'github',
      'instagram',
      'linkedin'
    ])
    expect(TINYTINKERER_SOCIALS.find((social) => social.kind === 'github')?.href).toBe(
      'https://github.com/nntin/tinytinkerer'
    )
    for (const social of TINYTINKERER_SOCIALS) {
      expect(social.href).toMatch(/^https:\/\//)
    }
  })

  it('embeds the license text from the repository root LICENSE', () => {
    expect(LICENSE_TEXT.length).toBeGreaterThan(0)
    expect(LICENSE_TEXT).toContain('Copyright (c) 2026 Tin Nguyen')
  })
})
