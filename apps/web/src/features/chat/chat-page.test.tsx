import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// ChatPage is now a thin wrapper over the shared ChatApp in its docked (sidebar)
// layout. The docked body's behavior (send/stop/reset, inspector slot, settings) is
// covered by app-browser's docked-chat-surface test; here we only assert the web
// shell wires the right layout props and passes its inspector slot.
const captured = vi.hoisted(() => ({ props: undefined as Record<string, unknown> | undefined }))

vi.mock('@tinytinkerer/app-browser', () => ({
  ChatApp: (props: Record<string, unknown>) => {
    captured.props = props
    return <div data-chat-app="true" />
  },
  ContextInspectorSlot: () => <div data-inspector-slot="true" />
}))

import { ChatPage } from './chat-page.js'

beforeEach(() => {
  captured.props = undefined
})

describe('ChatPage', () => {
  it('renders the shared chat in the docked (sidebar) comfortable layout', () => {
    render(<ChatPage />)

    expect(captured.props?.mode).toBe('sidebar')
    expect(captured.props?.sizeVariant).toBe('comfortable')
    expect(captured.props?.storageKey).toBe('tinytinkerer:web-layout:v1')
    expect(captured.props?.inspectorPanelSupported).toBe(true)
    expect(captured.props?.LoadingComponent).toBeTypeOf('function')
  })

  it('passes the web-only context inspector slot', () => {
    render(<ChatPage />)
    expect(captured.props?.inspectorSlot).toBeTruthy()
  })
})
