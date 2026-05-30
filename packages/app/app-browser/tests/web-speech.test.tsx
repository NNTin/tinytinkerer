// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const settingsMock = vi.hoisted(() => ({ webSpeechEnabled: true }))

vi.mock('../src/app.js', () => ({
  useSettingsStore: <T,>(selector: (state: { webSpeechEnabled: boolean }) => T): T =>
    selector(settingsMock)
}))

import { useWebSpeechInput } from '../src/web-speech.js'

type RecognitionHandlers = {
  onend: (() => void) | null
  onerror: ((event: { error?: string }) => void) | null
  onresult: ((event: unknown) => void) | null
}

class MockRecognition implements RecognitionHandlers {
  static instances: MockRecognition[] = []
  continuous = false
  interimResults = false
  lang = ''
  onend: (() => void) | null = null
  onerror: ((event: { error?: string }) => void) | null = null
  onresult: ((event: unknown) => void) | null = null
  start = vi.fn()
  stop = vi.fn()

  constructor() {
    MockRecognition.instances.push(this)
  }
}

const setSpeechRecognition = (ctor: typeof MockRecognition | undefined): void => {
  Object.defineProperty(window, 'SpeechRecognition', { value: ctor, configurable: true, writable: true })
  Object.defineProperty(window, 'webkitSpeechRecognition', {
    value: undefined,
    configurable: true,
    writable: true
  })
}

const setGetUserMedia = (impl: () => Promise<MediaStream>): void => {
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia: impl },
    configurable: true,
    writable: true
  })
}

const grantedStream = (): Promise<MediaStream> =>
  Promise.resolve({ getTracks: () => [{ stop: vi.fn() }] } as unknown as MediaStream)

const noopProps = { prompt: '', setPrompt: vi.fn() }

beforeEach(() => {
  settingsMock.webSpeechEnabled = true
  MockRecognition.instances = []
  setSpeechRecognition(MockRecognition)
  setGetUserMedia(grantedStream)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('useWebSpeechInput', () => {
  it('reports unavailable when the browser does not expose SpeechRecognition', () => {
    setSpeechRecognition(undefined)
    const { result } = renderHook(() => useWebSpeechInput(noopProps))
    expect(result.current.available).toBe(false)
  })

  it('surfaces a permission error when microphone access is denied', async () => {
    setGetUserMedia(() => Promise.reject(new DOMException('denied', 'NotAllowedError')))
    const { result } = renderHook(() => useWebSpeechInput(noopProps))

    await act(async () => {
      await result.current.toggle()
    })

    expect(result.current.listening).toBe(false)
    expect(result.current.error).toMatch(/microphone access was denied/i)
    expect(MockRecognition.instances).toHaveLength(0)
  })

  it('starts listening when microphone access is granted', async () => {
    const { result } = renderHook(() => useWebSpeechInput(noopProps))

    await act(async () => {
      await result.current.toggle()
    })

    expect(result.current.listening).toBe(true)
    expect(result.current.error).toBeNull()
    expect(MockRecognition.instances).toHaveLength(1)
    expect(MockRecognition.instances[0]?.start).toHaveBeenCalledTimes(1)
  })

  it('stops an active session when voice input is disabled in settings', async () => {
    const { result, rerender } = renderHook(() => useWebSpeechInput(noopProps))

    await act(async () => {
      await result.current.toggle()
    })
    expect(result.current.listening).toBe(true)

    settingsMock.webSpeechEnabled = false
    act(() => {
      rerender()
    })

    expect(MockRecognition.instances[0]?.stop).toHaveBeenCalledTimes(1)
    expect(result.current.listening).toBe(false)
    expect(result.current.visible).toBe(false)
  })

  it('maps a recognition error event to a user-facing message', async () => {
    const { result } = renderHook(() => useWebSpeechInput(noopProps))

    await act(async () => {
      await result.current.toggle()
    })

    act(() => {
      MockRecognition.instances[0]?.onerror?.({ error: 'network' })
    })

    expect(result.current.error).toMatch(/network error/i)
    expect(result.current.listening).toBe(false)
  })

  it('ignores benign aborted errors triggered by stopping', async () => {
    const { result } = renderHook(() => useWebSpeechInput(noopProps))

    await act(async () => {
      await result.current.toggle()
    })

    act(() => {
      MockRecognition.instances[0]?.onerror?.({ error: 'aborted' })
    })

    expect(result.current.error).toBeNull()
  })
})
