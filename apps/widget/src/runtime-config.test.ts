import { describe, expect, it } from 'vitest'
import { resolveWidgetWindowMode } from './runtime-config'

describe('widget runtime config', () => {
  it('detects the minimized widget mode from the query string', () => {
    expect(resolveWidgetWindowMode('?mode=minimized')).toBe('minimized')
    expect(resolveWidgetWindowMode('')).toBe('expanded')
  })
})
