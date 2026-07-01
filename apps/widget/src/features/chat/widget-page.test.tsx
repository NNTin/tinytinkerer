import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// WidgetPage is now a thin shell over the shared ChatApp (whose behavior — layouts,
// morph, send/stop/settings — is tested in app-browser). Here we only assert the
// widget wires the floating layout, its boot copy + layout key, and the URL-derived
// window mode correctly.
const captured = vi.hoisted(() => ({ props: undefined as Record<string, unknown> | undefined }))

vi.mock('@tinytinkerer/app-browser', () => ({
  ChatApp: (props: Record<string, unknown>) => {
    captured.props = props
    return <div data-chat-app="true" />
  }
}))

import { WidgetPage } from './widget-page.js'

beforeEach(() => {
  captured.props = undefined
  window.history.replaceState({}, '', '/widget/')
})

describe('WidgetPage', () => {
  it('renders the shared chat in the floating layout by default', () => {
    render(<WidgetPage />)

    expect(captured.props?.mode).toBe('floating')
    expect(captured.props?.initialMinimized).toBe(false)
    expect(captured.props?.storageKey).toBe('tinytinkerer:widget-layout:v1')
    expect(captured.props?.LoadingComponent).toBeTypeOf('function')
  })

  it('starts minimized when the URL requests the minimized window mode', () => {
    window.history.replaceState({}, '', '/widget/?mode=minimized')

    render(<WidgetPage />)

    expect(captured.props?.mode).toBe('floating')
    expect(captured.props?.initialMinimized).toBe(true)
  })
})
