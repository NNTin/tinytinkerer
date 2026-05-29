import { useEffect, useState } from 'react'
import { useBrowserApp, useSettingsStore } from '../app'
import { useGitHubUser } from '../github-user'
import { setTelemetryGitHubId } from './telemetry'
import { PrivacyPolicyDialog } from './privacy-policy-dialog'

export const CONSENT_PROMPTED_KEY = 'telemetry_consent_prompted'

/**
 * Shows the one-time telemetry consent notice on first run and keeps the
 * telemetry GitHub ID in sync with the signed-in GitHub user. Mount once near
 * the app root in standalone apps (web, mobile). Not used in the embedded
 * widget surface.
 */
export const TelemetryConsentGate = () => {
  const { shell } = useBrowserApp()
  const hydrated = useSettingsStore((state) => state.hydrated)
  const setTelemetryEnabled = useSettingsStore((state) => state.setTelemetryEnabled)
  const user = useGitHubUser()

  const [promptVisible, setPromptVisible] = useState(false)
  const [policyOpen, setPolicyOpen] = useState(false)

  // Keep the GitHub identity current for telemetry headers.
  useEffect(() => {
    setTelemetryGitHubId(user?.login ?? null)
  }, [user])

  // Decide whether to show the first-run notice once settings have hydrated.
  useEffect(() => {
    if (!hydrated) {
      return
    }
    let cancelled = false
    void shell.preferences.get(CONSENT_PROMPTED_KEY).then((value) => {
      if (!cancelled && value !== 'true') {
        setPromptVisible(true)
      }
    })
    return () => {
      cancelled = true
    }
  }, [hydrated, shell])

  const markPrompted = async () => {
    await shell.preferences.set(CONSENT_PROMPTED_KEY, 'true')
    setPromptVisible(false)
  }

  const onAccept = async () => {
    await setTelemetryEnabled(true)
    await markPrompted()
  }

  const onDecline = async () => {
    await markPrompted()
  }

  return (
    <>
      {promptVisible ? (
        <div className="fixed inset-0 z-[60]">
          <div className="settings-overlay absolute inset-0 bg-stone-900/30 backdrop-blur-sm" data-state="open" />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Telemetry"
            className="settings-content fixed left-1/2 top-1/2 z-[70] w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-6 shadow-xl outline-none"
            data-state="open"
          >
            <h2 className="text-base font-semibold text-stone-900">Help improve TinyTinkerer</h2>
            <p className="mt-3 text-sm leading-relaxed text-stone-700">
              We collect optional crash and error diagnostics to fix bugs and improve reliability.
              No message content is collected. Diagnostics use a random install ID; when you&apos;re
              signed in they may be linked to your GitHub account. You can change this anytime in
              Settings → Privacy.
            </p>
            <button
              type="button"
              onClick={() => setPolicyOpen(true)}
              className="mt-2 text-sm font-medium text-amber-700 underline-offset-2 hover:underline"
            >
              Learn more
            </button>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => void onDecline()}
                className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm text-stone-600 transition-colors hover:bg-stone-100"
              >
                Continue without
              </button>
              <button
                type="button"
                onClick={() => void onAccept()}
                className="rounded-lg bg-amber-500 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-amber-600"
              >
                Accept
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <PrivacyPolicyDialog open={policyOpen} onClose={() => setPolicyOpen(false)} />
    </>
  )
}
