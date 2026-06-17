import { useEffect, useMemo, useRef, useState } from 'react'
import { useSettingsStore } from './app'

type SpeechRecognitionAlternativeLike = {
  transcript?: string
}

type SpeechRecognitionResultLike = ArrayLike<SpeechRecognitionAlternativeLike> & {
  isFinal?: boolean
}

type SpeechRecognitionEventLike = {
  resultIndex: number
  results: ArrayLike<SpeechRecognitionResultLike>
}

type SpeechRecognitionErrorEventLike = {
  error?: string
}

type SpeechRecognitionLike = {
  continuous: boolean
  interimResults: boolean
  lang: string
  onend: (() => void) | null
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  start: () => void
  stop: () => void
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike

type BrowserSpeechWindow = Window &
  typeof globalThis & {
    SpeechRecognition?: SpeechRecognitionConstructor
    webkitSpeechRecognition?: SpeechRecognitionConstructor
  }

const getSpeechRecognitionConstructor = (): SpeechRecognitionConstructor | undefined => {
  if (typeof window === 'undefined') {
    return undefined
  }

  const browserWindow = window as BrowserSpeechWindow
  return browserWindow.SpeechRecognition ?? browserWindow.webkitSpeechRecognition
}

const appendTranscript = (base: string, addition: string): string => {
  const trimmedAddition = addition.trim()
  if (!trimmedAddition) {
    return base
  }

  return base.trimEnd().length > 0 ? `${base.trimEnd()} ${trimmedAddition}` : trimmedAddition
}

const requestMicrophonePermission = async (): Promise<void> => {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    return
  }

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  for (const track of stream.getTracks()) {
    track.stop()
  }
}

const MICROPHONE_DENIED_MESSAGE =
  'Microphone access was denied. Allow it in your browser settings to use voice input.'

const describeMicrophoneError = (error: unknown): string => {
  if (
    error instanceof DOMException &&
    (error.name === 'NotAllowedError' || error.name === 'SecurityError')
  ) {
    return MICROPHONE_DENIED_MESSAGE
  }
  if (error instanceof DOMException && error.name === 'NotFoundError') {
    return 'No microphone was found on this device.'
  }
  return 'Could not access the microphone for voice input.'
}

// Maps a SpeechRecognition error code to a user-facing message, or null when the
// error is benign (e.g. the user stopped dictation, or a transient silence).
const describeRecognitionError = (code: string | undefined): string | null => {
  switch (code) {
    case 'aborted':
    case 'no-speech':
      return null
    case 'not-allowed':
    case 'service-not-allowed':
      return MICROPHONE_DENIED_MESSAGE
    case 'audio-capture':
      return 'No microphone was found on this device.'
    case 'network':
      return 'Voice input failed due to a network error.'
    default:
      return 'Voice input stopped unexpectedly. Please try again.'
  }
}

export const useWebSpeechInput = ({
  prompt,
  setPrompt
}: {
  prompt: string
  setPrompt: (value: string) => void
}): {
  visible: boolean
  available: boolean
  listening: boolean
  error: string | null
  toggle: () => Promise<void>
  stop: () => void
} => {
  const visible = useSettingsStore((state) => state.webSpeechEnabled)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const promptBaseRef = useRef(prompt)
  const finalTranscriptRef = useRef('')
  const [available] = useState(() => getSpeechRecognitionConstructor() !== undefined)
  const [listening, setListening] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const stop = useMemo(
    () => () => {
      recognitionRef.current?.stop()
      recognitionRef.current = null
      setListening(false)
    },
    []
  )

  useEffect(() => stop, [stop])

  // Stop an active session if the user disables voice input in Settings while
  // dictating — otherwise the microphone would stay live with no UI to stop it.
  useEffect(() => {
    if (!visible) {
      stop()
    }
  }, [visible, stop])

  const toggle = async (): Promise<void> => {
    if (listening) {
      stop()
      return
    }

    const Recognition = getSpeechRecognitionConstructor()
    if (!Recognition) {
      return
    }

    promptBaseRef.current = prompt
    finalTranscriptRef.current = ''
    setError(null)

    try {
      await requestMicrophonePermission()
    } catch (permissionError) {
      setError(describeMicrophoneError(permissionError))
      setListening(false)
      return
    }

    const recognition = new Recognition()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = typeof navigator !== 'undefined' ? navigator.language : 'en-US'
    recognition.onresult = (event) => {
      let nextFinalTranscript = finalTranscriptRef.current
      let interimTranscript = ''

      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index]
        if (!result) {
          continue
        }
        const segment = result?.[0]?.transcript?.trim() ?? ''
        if (!segment) {
          continue
        }

        if (result.isFinal) {
          nextFinalTranscript = appendTranscript(nextFinalTranscript, segment)
        } else {
          interimTranscript = appendTranscript(interimTranscript, segment)
        }
      }

      finalTranscriptRef.current = nextFinalTranscript
      setPrompt(
        appendTranscript(
          promptBaseRef.current,
          appendTranscript(nextFinalTranscript, interimTranscript)
        )
      )
    }
    recognition.onerror = (event) => {
      const message = describeRecognitionError(event.error)
      if (message) {
        setError(message)
      }
      recognitionRef.current = null
      setListening(false)
    }
    recognition.onend = () => {
      recognitionRef.current = null
      setListening(false)
    }
    recognition.start()
    recognitionRef.current = recognition
    setListening(true)
  }

  return {
    visible,
    available,
    listening,
    error,
    toggle,
    stop
  }
}
