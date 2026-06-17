import { describe, expect, it } from 'vitest'
import { resolveWidgetViewMode, resolveWidgetWindowMode } from './runtime-config'

describe('widget runtime config', () => {
  it('detects host rendering mode from the query string', () => {
    expect(resolveWidgetViewMode('?view=host')).toBe('host')
    expect(resolveWidgetViewMode('')).toBe('standalone')
  })

  it('detects the minimized widget mode from the query string', () => {
    expect(resolveWidgetWindowMode('?mode=minimized')).toBe('minimized')
    expect(resolveWidgetWindowMode('?view=host')).toBe('expanded')
  })
})
