// @vitest-environment jsdom
import { act } from 'react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { mountExcalidrawApp } from '../src'

vi.mock('@excalidraw/excalidraw', () => ({
  Excalidraw: () => <div data-testid="excalidraw">whiteboard</div>,
  CaptureUpdateAction: { IMMEDIATELY: 'immediately' },
  convertToExcalidrawElements: vi.fn()
}))

const actEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean
}

beforeAll(() => {
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true
})

describe('mountExcalidrawApp', () => {
  it('renders an explanatory error without a harness nonce', () => {
    const root = document.createElement('div')
    let unmount: () => void = () => {}

    act(() => {
      unmount = mountExcalidrawApp(root, '')
    })
    expect(root.textContent).toContain('must be opened by the canvas harness')

    act(unmount)
    expect(root.innerHTML).toBe('')
  })

  it('mounts the whiteboard for a harness session and returns cleanup', () => {
    const root = document.createElement('div')
    let unmount: () => void = () => {}

    act(() => {
      unmount = mountExcalidrawApp(root, '#app-bridge-nonce=session-123')
    })
    expect(root.textContent).toContain('whiteboard')

    act(unmount)
    expect(root.innerHTML).toBe('')
  })
})
