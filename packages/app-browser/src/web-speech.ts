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

type SpeechRecognitionLike = {
  continuous: boolean
  interimResults: boolean
  lang: string
  onend: (() => void) | null
  onerror: (() => void) | null
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
  toggle: () => Promise<void>
  stop: () => void
} => {
  const visible = useSettingsStore((state) => state.webSpeechEnabled)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const promptBaseRef = useRef(prompt)
  const finalTranscriptRef = useRef('')
  const [available, setAvailable] = useState(() => getSpeechRecognitionConstructor() !== undefined)
  const [listening, setListening] = useState(false)

  useEffect(() => {
    setAvailable(getSpeechRecognitionConstructor() !== undefined)
  }, [])

  const stop = useMemo(
    () => () => {
      recognitionRef.current?.stop()
      recognitionRef.current = null
      setListening(false)
    },
    []
  )

  useEffect(() => stop, [stop])

  const toggle = async (): Promise<void> => {
    if (listening) {
      stop()
      return
    }

    const Recognition = getSpeechRecognitionConstructor()
    if (!Recognition) {
      setAvailable(false)
      return
    }

    promptBaseRef.current = prompt
    finalTranscriptRef.current = ''

    try {
      await requestMicrophonePermission()
    } catch {
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
      setPrompt(appendTranscript(promptBaseRef.current, appendTranscript(nextFinalTranscript, interimTranscript)))
    }
    recognition.onerror = () => {
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
    toggle,
    stop
  }
}
