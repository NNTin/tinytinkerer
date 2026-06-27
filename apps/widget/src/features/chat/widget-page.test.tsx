import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// WidgetPage is now a thin shell over the shared FloatingWidgetChat (whose
// behavior — minimize/restore, host messaging, send/stop/settings — is tested in
// app-browser's floating-widget-chat test). Here we only assert the widget wires
// the URL-derived view/window mode and its own boot copy + layout key correctly.
const captured = vi.hoisted(() => ({ props: undefined as Record<string, unknown> | undefined }))

vi.mock('@tinytinkerer/app-browser', () => ({
  FloatingWidgetChat: (props: Record<string, unknown>) => {
    captured.props = props
    return <div data-floating-widget-chat="true" />
  }
}))

import { WidgetPage } from './widget-page.js'

beforeEach(() => {
  captured.props = undefined
  window.history.replaceState({}, '', '/widget/')
})

describe('WidgetPage', () => {
  it('renders the shared floating chat in standalone mode by default', () => {
    render(<WidgetPage />)

    expect(captured.props?.viewMode).toBe('standalone')
    expect(captured.props?.initialMinimized).toBe(false)
    expect(captured.props?.storageKey).toBe('tinytinkerer:widget-layout:v1')
    expect(captured.props?.LoadingComponent).toBeTypeOf('function')
  })

  it('selects host view mode and the minimized window mode from the URL', () => {
    window.history.replaceState({}, '', '/widget/?view=host&mode=minimized')

    render(<WidgetPage />)

    expect(captured.props?.viewMode).toBe('host')
    expect(captured.props?.initialMinimized).toBe(true)
  })
})
