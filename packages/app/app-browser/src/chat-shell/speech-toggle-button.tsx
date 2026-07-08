// Icon straight from react-icons (not @tinytinkerer/ui): app-browser must not depend
// on the ui package (see the surfaces' existing react-icons imports).
import { FaMicrophone } from 'react-icons/fa6'
import type { useWebSpeechInput } from '../web-speech'

// The composer's voice-input toggle, shared by the docked and floating chat
// surfaces (#375): the a11y strings, availability gating, and the listening
// styling are one decision — only sizing/palette classes differ per surface.
// Renders nothing while the Web Speech setting is off (speech.visible false).

export type SpeechToggleButtonProps = {
  speech: ReturnType<typeof useWebSpeechInput>
  // Surface sizing/shape classes, always applied.
  className: string
  // Surface palette while not listening; the listening rose palette is shared.
  idleClassName: string
  iconClassName: string
}

export const SpeechToggleButton = ({
  speech,
  className,
  idleClassName,
  iconClassName
}: SpeechToggleButtonProps) =>
  speech.visible ? (
    <button
      type="button"
      aria-label={speech.available ? 'Voice input' : 'Voice input unavailable'}
      aria-pressed={speech.listening}
      title={
        !speech.available
          ? 'Voice input is not available in this browser'
          : speech.listening
            ? 'Stop voice input'
            : 'Dictate with the Web Speech API'
      }
      disabled={!speech.available}
      onClick={() => void speech.toggle()}
      className={`${className} disabled:cursor-not-allowed disabled:opacity-50 ${
        speech.listening
          ? 'border-rose-300 bg-rose-50 text-rose-600 hover:bg-rose-100'
          : idleClassName
      }`}
    >
      <FaMicrophone className={iconClassName} aria-hidden="true" />
    </button>
  ) : null
