import { describe, expect, it } from 'vitest'
import { shellThemeToCssVars } from '../src/shell-theme.js'

describe('shellThemeToCssVars', () => {
  it('returns no vars when no theme is supplied', () => {
    expect(shellThemeToCssVars(undefined)).toEqual({})
    expect(shellThemeToCssVars({})).toEqual({})
  })

  it('maps each host token onto both the generic and widget custom properties', () => {
    const vars = shellThemeToCssVars({ background: '#101014', panel: '#1b1b22' }) as Record<
      string,
      string
    >
    expect(vars['--bg']).toBe('#101014')
    expect(vars['--widget-bg']).toBe('#101014')
    expect(vars['--panel']).toBe('#1b1b22')
    expect(vars['--widget-panel']).toBe('#1b1b22')
    // Unspecified tokens are left untouched so the shell defaults stay in effect.
    expect(vars['--text']).toBeUndefined()
    expect(vars['--border']).toBeUndefined()
  })

  it('maps accent only to the generic --accent token', () => {
    const vars = shellThemeToCssVars({
      text: '#eee',
      border: '#333',
      accent: '#7c5cff'
    }) as Record<string, string>
    expect(vars['--text']).toBe('#eee')
    expect(vars['--widget-text']).toBe('#eee')
    expect(vars['--border']).toBe('#333')
    expect(vars['--widget-border']).toBe('#333')
    expect(vars['--accent']).toBe('#7c5cff')
  })
})
