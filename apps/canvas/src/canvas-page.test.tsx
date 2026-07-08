// @vitest-environment jsdom
import '@testing-library/jest-dom'
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// CanvasPage is a thin shell over the harness: it points HarnessShell at the
// embedded Excalidraw app and configures the shared ChatApp (via `chat`). Here we
// only assert the harness wiring — in particular that the canvas shell opts into the
// developer context inspector (#393: the toggle was permanently disabled because the
// canvas page never passed `inspectorPanelSupported`, unlike the web/widget shells).
const captured = vi.hoisted(() => ({ props: undefined as Record<string, unknown> | undefined }))

vi.mock('@tinytinkerer/app-harness', () => ({
  HarnessShell: (props: Record<string, unknown>) => {
    captured.props = props
    return <div data-harness-shell="true" />
  },
  resolveEmbeddedAppUrl: () => 'https://example.test/excalidraw-app/'
}))

vi.mock('./library-relay', () => ({
  useLibraryImportRelay: () => undefined
}))

vi.mock('./canvas-runtime', () => ({
  canvasBridgeHandle: {
    setClient: vi.fn(),
    setUnavailable: vi.fn(),
    getStatus: () => 'ready',
    request: vi.fn()
  }
}))

import CanvasPage from './canvas-page'

beforeEach(() => {
  captured.props = undefined
})

afterEach(() => {
  cleanup()
})

describe('CanvasPage', () => {
  it('opts the shared chat into the developer context inspector (#393)', () => {
    render(<CanvasPage />)

    const chat = captured.props?.chat as Record<string, unknown> | undefined
    expect(chat?.inspectorPanelSupported).toBe(true)
    expect(chat?.storageKey).toBe('tinytinkerer:canvas-layout:v2')
  })
})
