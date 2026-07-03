import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ShellChatPage is a thin wrapper: it maps the resolved presentation descriptor onto
// the shared ChatApp props (whose behavior — layouts, morph, send/stop/settings — is
// tested in app-browser). Here we assert each endpoint selects the right layout,
// storage key, slots, and window mode. This is the merged replacement for the former
// per-app chat-page tests (web / widget / mobile).
const captured = vi.hoisted(() => ({ props: undefined as Record<string, unknown> | undefined }))

vi.mock('@tinytinkerer/app-browser', () => ({
  ChatApp: (props: Record<string, unknown>) => {
    captured.props = props
    return <div data-chat-app="true" />
  },
  ContextInspectorSlot: () => <div data-inspector-slot="true" />
}))

import { ShellChatPage } from './chat-surface'
import { resolvePresentation } from '../../presentations'

beforeEach(() => {
  captured.props = undefined
  window.history.replaceState({}, '', '/web/')
})

afterEach(() => {
  cleanup()
})

describe('ShellChatPage', () => {
  it('wires the web endpoint to a pinned comfortable sidebar with the inspector', () => {
    render(<ShellChatPage presentation={resolvePresentation('/web/')} />)

    expect(captured.props?.mode).toBe('sidebar')
    expect(captured.props?.morphable).toBe(false)
    expect(captured.props?.sizeVariant).toBe('comfortable')
    expect(captured.props?.storageKey).toBe('tinytinkerer:web-layout:v1')
    expect(captured.props?.inspectorPanelSupported).toBe(true)
    expect(captured.props?.inspectorSlot).toBeTruthy()
    expect(captured.props?.settingsFallback).toBeTruthy()
    expect(captured.props?.installSlot).toBeUndefined()
  })

  it('wires the widget endpoint to the floating morphable layout', () => {
    window.history.replaceState({}, '', '/widget/')
    render(<ShellChatPage presentation={resolvePresentation('/widget/')} />)

    expect(captured.props?.mode).toBe('floating')
    // morphable is left unset so the ChatApp default (true) offers the dock button.
    expect(captured.props?.morphable).toBeUndefined()
    expect(captured.props?.initialMinimized).toBe(false)
    expect(captured.props?.storageKey).toBe('tinytinkerer:widget-layout:v1')
    expect(captured.props?.inspectorPanelSupported).toBe(true)
    expect(captured.props?.installSlot).toBeUndefined()
  })

  it('starts the widget minimized when the URL requests the minimized window mode', () => {
    window.history.replaceState({}, '', '/widget/?mode=minimized')
    render(<ShellChatPage presentation={resolvePresentation('/widget/')} />)

    expect(captured.props?.mode).toBe('floating')
    expect(captured.props?.initialMinimized).toBe(true)
  })

  it('wires the mobile endpoint to the mobile sidebar with the install slot and no inspector', () => {
    window.history.replaceState({}, '', '/mobile/')
    render(<ShellChatPage presentation={resolvePresentation('/mobile/')} />)

    expect(captured.props?.mode).toBe('sidebar')
    expect(captured.props?.morphable).toBe(false)
    expect(captured.props?.sizeVariant).toBe('mobile')
    expect(captured.props?.storageKey).toBe('tinytinkerer:mobile-layout:v1')
    expect(captured.props?.installSlot).toBeTruthy()
    expect(captured.props?.settingsFallback).toBeTruthy()
    expect(captured.props?.inspectorPanelSupported).toBeUndefined()
    expect(captured.props?.inspectorSlot).toBeUndefined()
  })
})
