// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

// SpeechToggleButton (#375) is the shared composer voice-input control extracted
// from the docked and floating chat surfaces: the a11y strings, availability
// gating, and the listening styling are one decision, so we exercise that
// decision here directly rather than through both surfaces.

import { SpeechToggleButton } from '../src/chat-shell/speech-toggle-button.js'

type SpeechState = {
  visible: boolean
  available: boolean
  listening: boolean
  error: string | null
  toggle: () => Promise<void>
  stop: () => void
}

const makeSpeech = (overrides: Partial<SpeechState> = {}): SpeechState => ({
  visible: true,
  available: true,
  listening: false,
  error: null,
  toggle: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  stop: vi.fn<() => void>(),
  ...overrides
})

afterEach(() => {
  cleanup()
})

describe('SpeechToggleButton', () => {
  it('renders nothing when speech.visible is false', () => {
    render(
      <SpeechToggleButton
        speech={makeSpeech({ visible: false })}
        className="base"
        idleClassName="idle"
        iconClassName="icon"
      />
    )
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('renders a disabled, unavailable button when Web Speech API is unavailable', () => {
    render(
      <SpeechToggleButton
        speech={makeSpeech({ available: false })}
        className="base"
        idleClassName="idle"
        iconClassName="icon"
      />
    )
    const button = screen.getByRole('button', { name: 'Voice input unavailable' })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('title', 'Voice input is not available in this browser')
  })

  it('renders an enabled idle button and toggles on click when available', () => {
    const speech = makeSpeech()
    render(
      <SpeechToggleButton
        speech={speech}
        className="base"
        idleClassName="idle"
        iconClassName="icon"
      />
    )
    const button = screen.getByRole('button', { name: 'Voice input' })
    expect(button).not.toBeDisabled()
    expect(button).toHaveAttribute('aria-pressed', 'false')
    expect(button).toHaveAttribute('title', 'Dictate with the Web Speech API')

    fireEvent.click(button)
    expect(speech.toggle).toHaveBeenCalledTimes(1)
  })

  it('applies the shared listening rose styling and drops the idle className while listening', () => {
    render(
      <SpeechToggleButton
        speech={makeSpeech({ listening: true })}
        className="base"
        idleClassName="idle-only-class"
        iconClassName="icon"
      />
    )
    const button = screen.getByRole('button', { name: 'Voice input' })
    expect(button).toHaveAttribute('aria-pressed', 'true')
    expect(button).toHaveAttribute('title', 'Stop voice input')
    expect(button.className).toContain('border-rose-300 bg-rose-50 text-rose-600 hover:bg-rose-100')
    expect(button.className).not.toContain('idle-only-class')
  })
})
