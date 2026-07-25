import { describe, expect, it } from 'vitest'
import originalMdxComponents from '../../test/theme-original-mdx-components-stub'

describe('swizzled MDXComponents', () => {
  it('registers LiveLab, LiveSessionGate, and LabReset as global MDX components without dropping the theme defaults', async () => {
    const { default: components } = await import('../MDXComponents')
    expect(components.code).toBe(originalMdxComponents.code)
    expect(components.a).toBe(originalMdxComponents.a)
    expect(typeof components.LiveLab).toBe('function')
    expect(typeof components.LiveSessionGate).toBe('function')
    expect(typeof components.LabReset).toBe('function')
  })

  it('registers PluginToolPickerLab as a global MDX component', async () => {
    const { default: components } = await import('../MDXComponents')
    expect(typeof components.PluginToolPickerLab).toBe('function')
  })
})
