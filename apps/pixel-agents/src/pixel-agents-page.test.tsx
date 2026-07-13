// @vitest-environment jsdom
import '@testing-library/jest-dom'
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const captured = vi.hoisted(() => ({
  stageProps: undefined as Record<string, unknown> | undefined,
  chatProps: undefined as Record<string, unknown> | undefined
}))

vi.mock('@tinytinkerer/pixel-agents', () => ({
  PixelAgentsStage: (props: Record<string, unknown>) => {
    captured.stageProps = props
    return <div data-testid="pixel-agents-stage">{props.assistant as React.ReactNode}</div>
  }
}))

vi.mock('@tinytinkerer/app-browser', () => ({
  createAppLoadingScreens: () => ({
    BootScreen: () => null,
    RouteLoading: () => null,
    ChatLoading: () => null
  }),
  useChatStore: (selector: (state: { events: unknown[]; isRunning: boolean }) => unknown) =>
    selector({ events: [], isRunning: false }),
  ChatApp: (props: Record<string, unknown>) => {
    captured.chatProps = props
    return <div data-testid="pixel-agents-chat" />
  }
}))

import PixelAgentsPage from './pixel-agents-page'

beforeEach(() => {
  captured.stageProps = undefined
  captured.chatProps = undefined
})

afterEach(cleanup)

describe('PixelAgentsPage', () => {
  it('composes the office stage with docked sidebar chat', () => {
    render(<PixelAgentsPage />)

    expect(captured.stageProps?.assistant).toBeDefined()
    expect(captured.chatProps).toMatchObject({
      mode: 'sidebar',
      morphable: false,
      fill: true,
      storageKey: 'tinytinkerer:pixel-agents-chat-layout:v1',
      inspectorPanelSupported: true
    })
  })
})
