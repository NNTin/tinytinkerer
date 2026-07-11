import { useEffect, useRef } from 'react'
import { useBrowserApp } from '../app'
import type { SettingsStore } from '../stores/settings-store'
import { createKonamiRecognizer } from './sequence-recognizer'
import { KONAMI_SEQUENCE } from './konami-config'

// Fed into the recognizer instead of the real key whenever a modifier is held, so
// browser/OS shortcuts (Ctrl+A, Cmd+ArrowLeft, Alt+Tab, ...) can never advance —
// let alone complete — the sequence. It matches nothing in KONAMI_SEQUENCE.
const MODIFIER_SENTINEL = '\0'

// The preset + animation modules are dynamically imported ONLY once a match
// fires: the shell entry chunk has a 65 kB budget (apps/shell/src/bundle-size.test.ts)
// and this component is mounted unconditionally by every shell, so its own code
// must stay tiny — the two modules it pulls in (settings-store plumbing, and the
// Web Animations choreography) are not needed until the ten-key sequence actually
// completes.
const runKonami = async (settings: SettingsStore): Promise<void> => {
  try {
    const [{ applyKonamiPreset }, { runKonamiAnimation }] = await Promise.all([
      import('./apply-konami-preset'),
      import('./easter-egg-animation')
    ])
    // Start both, then await both — the preset and the animation are independent
    // and there's no reason to serialize them.
    await Promise.all([applyKonamiPreset(settings), runKonamiAnimation()])
  } catch (error) {
    console.error('Konami cheat code failed', error)
  }
}

// Renders nothing. Mounted once, document-wide, by BrowserAppShell's
// `mountGlobals` block (see browser-app-shell.tsx) — the same guard that mounts
// the HITL modal and the telemetry/privacy gates, so exactly one instance exists
// no matter how many App panes share the page (verified against apps/host's root
// composition, which renders three ChatApp panes under one BrowserAppShell).
export const KonamiCheatCode = () => {
  const { stores } = useBrowserApp()
  const settings = stores.settings
  // Guards against re-entrancy: a fast second full entry of the sequence while an
  // earlier run's preset/animation is still in flight is ignored rather than
  // starting a second, overlapping animation pass.
  const runningRef = useRef(false)

  useEffect(() => {
    const recognize = createKonamiRecognizer(KONAMI_SEQUENCE)

    const handleKeyDown = (event: KeyboardEvent): void => {
      // Mid-IME composition keydowns are not real key presses (e.g. an
      // in-progress CJK candidate selection) — ignore them entirely rather than
      // feeding them into the recognizer.
      if (event.isComposing) {
        return
      }

      const key = event.ctrlKey || event.metaKey || event.altKey ? MODIFIER_SENTINEL : event.key

      if (!recognize(key) || runningRef.current) {
        return
      }

      runningRef.current = true
      void runKonami(settings).finally(() => {
        runningRef.current = false
      })
    }

    // Deliberately NEVER calls preventDefault/stopPropagation: typing in inputs
    // (the composer, settings fields, ...) must be completely unaffected, and the
    // sequence must still count while focus is inside a text field.
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [settings])

  return null
}
