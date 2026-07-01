import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// MobilePage is now a thin wrapper over the shared ChatApp in its docked layout,
// `mobile` size variant. The docked body's behavior is covered by app-browser's
// docked-chat-surface test; here we only assert the mobile shell wires the right
// layout props and passes its install-banner slot.
const captured = vi.hoisted(() => ({ props: undefined as Record<string, unknown> | undefined }))

vi.mock('@tinytinkerer/app-browser', () => ({
  ChatApp: (props: Record<string, unknown>) => {
    captured.props = props
    return <div data-chat-app="true" />
  }
}))

import { MobilePage } from './mobile-page.js'

beforeEach(() => {
  captured.props = undefined
})

describe('MobilePage', () => {
  it('renders the shared chat in the docked (sidebar) mobile layout', () => {
    render(<MobilePage />)

    expect(captured.props?.mode).toBe('sidebar')
    expect(captured.props?.sizeVariant).toBe('mobile')
    expect(captured.props?.storageKey).toBe('tinytinkerer:mobile-layout:v1')
    expect(captured.props?.LoadingComponent).toBeTypeOf('function')
  })

  it('passes the mobile install-banner slot', () => {
    render(<MobilePage />)
    expect(captured.props?.installSlot).toBeTruthy()
  })
})
