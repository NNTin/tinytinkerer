import { describe, expect, it } from 'vitest'
import { resolveDockedPanelInsets } from '../src/chat-shell/use-docked-panel-metrics.js'

describe('resolveDockedPanelInsets', () => {
  it('normalizes a measured split to all four physical edges', () => {
    expect(resolveDockedPanelInsets({ edge: 'left', size: 420 })).toEqual({
      top: 0,
      right: 0,
      bottom: 0,
      left: 420
    })
  })

  it('releases the effective split while a host overlay suppresses the assistant', () => {
    expect(resolveDockedPanelInsets({ edge: 'right', size: 420 }, true)).toEqual({
      top: 0,
      right: 0,
      bottom: 0,
      left: 0
    })
  })
})
