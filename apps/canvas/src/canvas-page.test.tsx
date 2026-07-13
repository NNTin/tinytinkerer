// @vitest-environment jsdom
import '@testing-library/jest-dom'
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const captured = vi.hoisted(() => ({
  stageProps: undefined as Record<string, unknown> | undefined,
  chatProps: undefined as Record<string, unknown> | undefined
}))

vi.mock('@tinytinkerer/canvas', () => ({
  CanvasStage: (props: Record<string, unknown>) => {
    captured.stageProps = props
    return <div data-testid="canvas-stage">{props.assistant as React.ReactNode}</div>
  }
}))

vi.mock('@tinytinkerer/app-browser', () => ({
  createAppLoadingScreens: () => ({
    BootScreen: () => null,
    RouteLoading: () => null,
    ChatLoading: () => null
  }),
  ChatApp: (props: Record<string, unknown>) => {
    captured.chatProps = props
    return <div data-testid="canvas-chat" />
  }
}))

import CanvasPage from './canvas-page'

beforeEach(() => {
  captured.stageProps = undefined
  captured.chatProps = undefined
})

afterEach(cleanup)

describe('CanvasPage', () => {
  it('composes the canvas stage with docked sidebar chat', () => {
    render(<CanvasPage />)

    expect(captured.stageProps?.assistant).toBeDefined()
    expect(captured.chatProps).toMatchObject({
      mode: 'sidebar',
      morphable: false,
      fill: true,
      storageKey: 'tinytinkerer:canvas-chat-layout:v1',
      inspectorPanelSupported: true
    })
  })
})
