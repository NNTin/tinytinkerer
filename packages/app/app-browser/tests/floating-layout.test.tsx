// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { act } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// FloatingLayout owns the floating window chrome (drag/minimize/restore/dock) and
// renders the shared FloatingChatSurface body. We mock the sibling source modules
// so the test exercises the window chrome + surface wiring (send/stop/settings)
// without a live app or runtime. The hooks' own logic is unit-tested elsewhere.

const mockAuthState = vi.hoisted(() => ({ token: null as string | null }))

const mockChatState = vi.hoisted(() => ({
  turns: [
    {
      id: 'turn-1',
      userText: 'hello',
      assistantContent: {
        nodes: [{ type: 'paragraph', children: [{ type: 'text', value: 'Hi there.' }] }]
      },
      isStreaming: false,
      notice: {
        kind: 'rate-limit' as const,
        message: 'Recovered after a short wait.',
        level: 'warning' as const
      }
    }
  ],
  events: [] as Array<{ id: string; type: string }>,
  isRunning: false,
  isCoolingDown: false,
  submitPrompt: vi.fn(() => true),
  rerunLastPrompt: vi.fn(),
  resetConversation: vi.fn(),
  cancelRetry: vi.fn(),
  stop: vi.fn(),
  conversations: [{ id: 'a', title: 'New conversation', isRunning: false }],
  activeConversationId: 'a',
  selectConversation: vi.fn(() => Promise.resolve()),
  startNewConversation: vi.fn(() => Promise.resolve()),
  deleteConversation: vi.fn(() => Promise.resolve()),
  sendRefusalNotice: null as string | null
}))

const mockSpeechState = vi.hoisted(() => ({
  visible: false,
  available: false,
  listening: false,
  error: null as string | null,
  toggle: vi.fn(() => Promise.resolve()),
  stop: vi.fn()
}))

vi.mock('../src/surfaces.js', async () => {
  const { useState } = await import('react')
  return {
    // Faithful stand-in for the shared composer hook: owns prompt state and the
    // submit → clear-on-accept behavior so the surface wiring can be exercised.
    useChatComposer: (submitPrompt: (prompt: string) => boolean) => {
      const [prompt, setPrompt] = useState('')
      const handleSubmit = (): boolean => {
        mockSpeechState.stop()
        const accepted = submitPrompt(prompt)
        if (accepted) {
          setPrompt('')
        }
        return accepted
      }
      return { prompt, setPrompt, speech: mockSpeechState, handleSubmit }
    },
    useChatSurfaceController: () => ({
      isBooting: false,
      events: mockChatState.events,
      turns: mockChatState.turns,
      serverNameById: new Map<string, string>(),
      isRunning: mockChatState.isRunning,
      isRetryPending: false,
      submitLabel: mockChatState.isRunning ? 'Thinking…' : 'Send',
      isCoolingDown: mockChatState.isCoolingDown,
      submitPrompt: mockChatState.submitPrompt,
      rerunLastPrompt: mockChatState.rerunLastPrompt,
      canRerun: false,
      resetConversation: mockChatState.resetConversation,
      cancelRetry: mockChatState.cancelRetry,
      stop: mockChatState.stop,
      conversations: mockChatState.conversations,
      activeConversationId: mockChatState.activeConversationId,
      selectConversation: mockChatState.selectConversation,
      startNewConversation: mockChatState.startNewConversation,
      deleteConversation: mockChatState.deleteConversation,
      sendRefusalNotice: mockChatState.sendRefusalNotice
    }),
    // `signInOpensSettings: true` is the shell-OAuth shape every product surface
    // has (issue #480): the composer's GitHub action opens Settings, where that
    // button lives, rather than starting a flow itself.
    useSettingsSurfaceController: () => ({
      token: mockAuthState.token,
      canSignIn: true,
      signIn: () => true,
      signInOpensSettings: true
    })
  }
})

vi.mock('../src/use-stick-to-bottom.js', () => ({
  useStickToBottom: () => ({
    scrollRef: { current: null },
    isPinned: true,
    showJumpButton: false,
    scrollToBottom: () => undefined
  })
}))

vi.mock('../src/conversation-empty-state.js', () => ({
  ConversationEmptyState: () => <div data-empty-state="true" />
}))

vi.mock('../src/turn-chrome.js', () => ({
  TurnChrome: ({
    turn
  }: {
    turn: {
      id: string
      assistantContent: { nodes: Array<{ children?: Array<{ value?: string }> }> } | null
    }
  }) =>
    turn.assistantContent ? (
      <div data-turn-id={turn.id}>{turn.assistantContent.nodes[0]?.children?.[0]?.value}</div>
    ) : null
}))

vi.mock('../src/jump-to-latest.js', () => ({
  JumpToLatestButton: ({ visible }: { visible: boolean }) =>
    visible ? (
      <button type="button" aria-label="Jump to latest">
        New messages
      </button>
    ) : null
}))

vi.mock('../src/human-prompt-composer-dock.js', () => ({
  HumanPromptComposerDock: () => null
}))

vi.mock('../src/lazy-browser-settings-modal.js', () => ({
  LazySettingsPanel: ({
    open,
    onOpenChange,
    inspectorPanelSupported
  }: {
    open: boolean
    onOpenChange: (open: boolean) => void
    presentation?: 'modal' | 'inline'
    inspectorPanelSupported?: boolean
  }) =>
    open ? (
      <div
        data-testid="settings-panel"
        data-inspector-supported={inspectorPanelSupported ? 'true' : 'false'}
      >
        <span>Settings modal</span>
        <button type="button" aria-label="Close settings" onClick={() => onOpenChange(false)}>
          Close
        </button>
      </div>
    ) : null
}))

vi.mock('../src/hooks.js', () => ({
  useBrowserShellConfig: () => ({ theme: undefined })
}))

vi.mock('../src/shell-theme.js', () => ({
  shellThemeToCssVars: () => ({})
}))

// The real ContextInspectorSlot renders nothing unless an inspector plugin is
// enabled and something has been captured (covered by context-inspector.test.tsx);
// here we only assert the surface renders it when inspectorPanelSupported is set.
vi.mock('../src/context-inspector.js', () => ({
  ContextInspectorSlot: () => <div data-testid="floating-inspector-slot" />
}))

// The real ToolTreeSlot needs a full BrowserApp context (settings store + plugin
// discovery) covered separately by tool-tree.test.tsx; here it's an unconditional
// slot (issue #400), so stub it to a no-op rather than mounting a live one.
vi.mock('../src/tool-tree.js', () => ({
  ToolTreeSlot: () => null
}))

import { FloatingChatSurface } from '../src/chat-shell/floating-chat-surface.js'
import { FloatingLayout } from '../src/chat-shell/floating-layout.js'

const Loading = ({ error }: { error?: string }) => <div data-loading="true">{error}</div>

const renderStandalone = (props?: { onDock?: () => void }) =>
  render(
    <FloatingLayout
      storageKey="test:widget-layout"
      {...(props?.onDock ? { onDock: props.onDock } : {})}
    >
      <FloatingChatSurface LoadingComponent={Loading} framed={false} />
    </FloatingLayout>
  )

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn()
  // jsdom does not implement pointer capture; stub it so the drag handlers can call
  // setPointerCapture (the #323 fix for keeping a drag alive outside the window).
  Element.prototype.setPointerCapture = vi.fn()
  Element.prototype.releasePointerCapture = vi.fn()
})

afterEach(() => {
  cleanup()
})

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
  mockAuthState.token = null
  mockChatState.isRunning = false
  mockChatState.isCoolingDown = false
  mockChatState.submitPrompt.mockReturnValue(true)
  mockSpeechState.visible = false
  mockSpeechState.available = false
  mockSpeechState.listening = false
  mockSpeechState.error = null
})

describe('FloatingLayout', () => {
  it('shows conversation-first layout with footer settings and sign-in actions', () => {
    renderStandalone()

    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign in with GitHub' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Minimize widget' })).toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.queryByRole('button', { name: /voice input/i })).toBeNull()
  })

  it('renders a turn notice and final assistant answer in the same card', () => {
    renderStandalone()

    expect(screen.getByText('Recovered after a short wait.')).toBeInTheDocument()
    expect(screen.getByText('Hi there.')).toBeInTheDocument()
  })

  it('lets long unbroken tokens wrap inside the user bubble (issue #358)', () => {
    renderStandalone()

    expect(screen.getByText('hello')).toHaveClass('wrap-anywhere')
  })

  it('submits prompts through the shared chat store', async () => {
    renderStandalone()

    await act(async () => {
      fireEvent.change(
        screen.getByPlaceholderText(
          'Ask something current, compare options, or continue the thread.'
        ),
        { target: { value: 'Tell me something current' } }
      )
      fireEvent.click(screen.getByRole('button', { name: 'Send' }))
      await Promise.resolve()
    })

    expect(mockChatState.submitPrompt).toHaveBeenCalledWith('Tell me something current')
  })

  it('clears the input immediately once a prompt is accepted (issue #206)', () => {
    renderStandalone()

    const textarea = screen.getByPlaceholderText<HTMLTextAreaElement>(
      'Ask something current, compare options, or continue the thread.'
    )

    fireEvent.change(textarea, { target: { value: 'Next question' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    expect(mockChatState.submitPrompt).toHaveBeenCalledWith('Next question')
    expect(textarea.value).toBe('')
  })

  it('does not clear the input when the send is rejected', () => {
    mockChatState.submitPrompt.mockReturnValue(false)
    renderStandalone()

    const textarea = screen.getByPlaceholderText<HTMLTextAreaElement>(
      'Ask something current, compare options, or continue the thread.'
    )

    fireEvent.change(textarea, { target: { value: 'Blocked message' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    expect(textarea.value).toBe('Blocked message')
  })

  it('replaces send with a Stop button while the agent is running', () => {
    mockChatState.isRunning = true
    renderStandalone()

    const stopButton = screen.getByRole('button', { name: 'Stop generating' })
    expect(stopButton).not.toBeDisabled()
    fireEvent.click(stopButton)
    expect(mockChatState.stop).toHaveBeenCalledTimes(1)
  })

  it('opens settings from the footer trigger', () => {
    renderStandalone()

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))

    expect(screen.getByText('Settings modal')).toBeInTheDocument()
  })

  it('renders a disabled voice button when Web Speech API is unavailable', () => {
    mockSpeechState.visible = true
    renderStandalone()
    expect(screen.getByRole('button', { name: /voice input unavailable/i })).toBeDisabled()
  })

  it('collapses to a launcher and restores in standalone mode', () => {
    renderStandalone()

    fireEvent.click(screen.getByRole('button', { name: 'Minimize widget' }))
    expect(screen.getByRole('button', { name: 'Restore widget' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Restore widget' }))
    expect(screen.getByRole('button', { name: 'Minimize widget' })).toBeInTheDocument()
  })

  it('shows a dock button only when onDock is provided and invokes it', () => {
    const onDock = vi.fn()
    const { rerender } = render(
      <FloatingLayout storageKey="test:widget-layout">
        <FloatingChatSurface LoadingComponent={Loading} framed={false} />
      </FloatingLayout>
    )
    expect(screen.queryByRole('button', { name: 'Dock to sidebar' })).toBeNull()

    rerender(
      <FloatingLayout storageKey="test:widget-layout" onDock={onDock}>
        <FloatingChatSurface LoadingComponent={Loading} framed={false} />
      </FloatingLayout>
    )
    fireEvent.click(screen.getByRole('button', { name: 'Dock to sidebar' }))
    // The dock button docks to the caller's side, so it passes no snap edge.
    expect(onDock).toHaveBeenCalledTimes(1)
    expect(onDock).toHaveBeenCalledWith()
  })

  it('captures the pointer when a grip drag starts (#323: drag survives leaving the window)', () => {
    const capture = vi.spyOn(Element.prototype, 'setPointerCapture')
    renderStandalone()

    const grip = screen.getByRole('button', { name: /move widget/i })
    fireEvent.pointerDown(grip, { clientX: 200, clientY: 400, pointerId: 7 })

    expect(capture).toHaveBeenCalledWith(7)
    capture.mockRestore()
  })

  it('can be dragged while minimized without restoring (#323 bullet 2)', () => {
    const { container } = renderStandalone()

    fireEvent.click(screen.getByRole('button', { name: 'Minimize widget' }))
    const launcher = screen.getByRole('button', { name: 'Restore widget' })
    const shell = container.querySelector('.widget-floating-shell') as HTMLElement
    const startLeft = shell.style.left

    // Drag the launcher past the click threshold.
    fireEvent.pointerDown(launcher, { clientX: 100, clientY: 100, pointerId: 3 })
    fireEvent.pointerMove(window, { clientX: 180, clientY: 160 })
    fireEvent.pointerUp(window)

    // It moved…
    expect(shell.style.left).not.toBe(startLeft)
    // …and the trailing click does NOT restore (still minimized).
    fireEvent.click(launcher)
    expect(screen.getByRole('button', { name: 'Restore widget' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Minimize widget' })).toBeNull()
  })

  it('still restores on a plain click while minimized (no drag)', () => {
    renderStandalone()

    fireEvent.click(screen.getByRole('button', { name: 'Minimize widget' }))
    const launcher = screen.getByRole('button', { name: 'Restore widget' })

    // A press that does not move is a click, not a drag.
    fireEvent.pointerDown(launcher, { clientX: 100, clientY: 100, pointerId: 4 })
    fireEvent.pointerUp(window)
    fireEvent.click(launcher)

    expect(screen.getByRole('button', { name: 'Minimize widget' })).toBeInTheDocument()
  })

  it('shows a snap preview near an edge and docks to it on release (#324)', () => {
    const onDock = vi.fn()
    const { container } = renderStandalone({ onDock })

    const grip = screen.getByRole('button', { name: /move widget/i })
    fireEvent.pointerDown(grip, { clientX: 300, clientY: 400, pointerId: 9 })

    // No preview until the pointer nears an edge.
    expect(container.querySelector('.widget-snap-preview')).toBeNull()

    // Drag toward the right edge (past innerWidth - threshold).
    fireEvent.pointerMove(window, { clientX: window.innerWidth - 5, clientY: 400 })
    const preview = container.querySelector('.widget-snap-preview')
    expect(preview).not.toBeNull()
    expect(preview).toHaveAttribute('data-edge', 'right')

    fireEvent.pointerUp(window)
    expect(onDock).toHaveBeenCalledWith('right')
    // The preview is cleared once the drag ends.
    expect(container.querySelector('.widget-snap-preview')).toBeNull()
  })

  it('does not snap-dock when the drag stays clear of every edge (#324)', () => {
    const onDock = vi.fn()
    renderStandalone({ onDock })

    const grip = screen.getByRole('button', { name: /move widget/i })
    fireEvent.pointerDown(grip, { clientX: 300, clientY: 400, pointerId: 11 })
    fireEvent.pointerMove(window, { clientX: 320, clientY: 420 })
    fireEvent.pointerUp(window)

    expect(onDock).not.toHaveBeenCalled()
  })

  it('does not dock on a sub-threshold press inside a snap zone (#336)', () => {
    const onDock = vi.fn()
    const { container } = renderStandalone({ onDock })

    // The grip starts inside the top snap zone (safe margin < SNAP_THRESHOLD), so a
    // press with only jitter must stay a click — no preview, no dock.
    const grip = screen.getByRole('button', { name: /move widget/i })
    fireEvent.pointerDown(grip, { clientX: 300, clientY: 10, pointerId: 12 })
    fireEvent.pointerMove(window, { clientX: 301, clientY: 11 })
    expect(container.querySelector('.widget-snap-preview')).toBeNull()
    fireEvent.pointerUp(window)

    expect(onDock).not.toHaveBeenCalled()
  })

  it('does not dock when sliding along an edge without travel toward it (#336)', () => {
    const onDock = vi.fn()
    const { container } = renderStandalone({ onDock })

    const grip = screen.getByRole('button', { name: /move widget/i })
    fireEvent.pointerDown(grip, { clientX: 300, clientY: 30, pointerId: 13 })
    // Well past the click threshold and inside the top zone throughout, but with no
    // vertical travel toward the edge — sliding along it is not intent to dock.
    fireEvent.pointerMove(window, { clientX: 500, clientY: 30 })
    expect(container.querySelector('.widget-snap-preview')).toBeNull()
    fireEvent.pointerUp(window)

    expect(onDock).not.toHaveBeenCalled()
  })

  it('docks after deliberate travel toward the edge (#336)', () => {
    const onDock = vi.fn()
    const { container } = renderStandalone({ onDock })

    const grip = screen.getByRole('button', { name: /move widget/i })
    fireEvent.pointerDown(grip, { clientX: 300, clientY: 300, pointerId: 14 })
    fireEvent.pointerMove(window, { clientX: 300, clientY: 10 })
    const preview = container.querySelector('.widget-snap-preview')
    expect(preview).not.toBeNull()
    expect(preview).toHaveAttribute('data-edge', 'top')

    fireEvent.pointerUp(window)
    expect(onDock).toHaveBeenCalledWith('top')
  })

  it('reverts instead of docking when the browser cancels the drag (#336)', () => {
    const onDock = vi.fn()
    const { container } = renderStandalone({ onDock })

    const shell = container.querySelector('.widget-floating-shell') as HTMLElement
    const startLeft = shell.style.left
    const startTop = shell.style.top

    const grip = screen.getByRole('button', { name: /move widget/i })
    fireEvent.pointerDown(grip, { clientX: 300, clientY: 300, pointerId: 15 })
    fireEvent.pointerMove(window, { clientX: 300, clientY: 10 })
    expect(container.querySelector('.widget-snap-preview')).not.toBeNull()

    // The browser reclaims the pointer (e.g. touch takeover): the gesture must
    // revert to the pre-drag layout, never commit the dock.
    fireEvent.pointerCancel(window)
    expect(onDock).not.toHaveBeenCalled()
    expect(container.querySelector('.widget-snap-preview')).toBeNull()
    expect(shell.style.left).toBe(startLeft)
    expect(shell.style.top).toBe(startTop)
  })

  it('reverts an aborted resize instead of committing the mid-drag size (#371)', () => {
    const { container } = renderStandalone()

    const shell = container.querySelector('.widget-floating-shell') as HTMLElement
    const startWidth = shell.style.width
    const startHeight = shell.style.height

    const resizeHandle = screen.getByRole('button', {
      name: 'Resize widget. Use arrow keys to resize, Shift with arrow keys to move.'
    })
    fireEvent.pointerDown(resizeHandle, { clientX: 300, clientY: 300, pointerId: 20 })
    fireEvent.pointerMove(window, { clientX: 340, clientY: 360 })
    expect(shell.style.width).not.toBe(startWidth)
    expect(shell.style.height).not.toBe(startHeight)

    // The browser reclaims the pointer mid-resize: revert to the pre-drag size,
    // never commit the mid-drag dimensions (#336 policy, applied to resize too).
    fireEvent.pointerCancel(window)
    expect(shell.style.width).toBe(startWidth)
    expect(shell.style.height).toBe(startHeight)
  })
})

describe('FloatingChatSurface inspector wiring', () => {
  it('renders the inspector slot and enables inspector support in the inline settings', () => {
    render(
      <FloatingChatSurface LoadingComponent={Loading} framed={false} inspectorPanelSupported />
    )

    // The viewer button slot is rendered in the composer's left action row.
    expect(screen.getByTestId('floating-inspector-slot')).toBeInTheDocument()

    // Opening settings forwards inspectorPanelSupported so the plugin toggle is enabled.
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    expect(screen.getByTestId('settings-panel')).toHaveAttribute('data-inspector-supported', 'true')
  })

  it('leaves inspector support off and renders no slot by default', () => {
    render(<FloatingChatSurface LoadingComponent={Loading} framed={false} />)
    expect(screen.queryByTestId('floating-inspector-slot')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    expect(screen.getByTestId('settings-panel')).toHaveAttribute(
      'data-inspector-supported',
      'false'
    )
  })
})
