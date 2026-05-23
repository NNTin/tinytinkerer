import { describe, expect, it } from 'vitest'
import { brandDefinitionSchema } from '@tinytinkerer/contracts'
import { TINYTINKERER_BRAND } from '../src/index.js'

describe('brand assets', () => {
  it('exports placeholder brand data matching shared contracts', () => {
    expect(brandDefinitionSchema.parse(TINYTINKERER_BRAND).theme.applicationName).toBe(
      'tinytinkerer'
    )
  })

  it('uses inline placeholder asset URLs', () => {
    expect(TINYTINKERER_BRAND.links[0]?.href).toMatch(/^data:image\/svg\+xml/)
    expect(TINYTINKERER_BRAND.manifest.icons[0]?.src).toMatch(/^data:image\/svg\+xml/)
  })
})
