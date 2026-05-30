import { useEffect, useState } from 'react'
import { useBrowserApp } from '../app'
import { MarkdownDocument } from '../markdown-document'
import { CONSENT_PROMPTED_KEY } from './consent-gate'
import { PrivacyPolicyDialog } from './privacy-policy-dialog'
import { PRIVACY_POLICY_UPDATE_NOTICE, PRIVACY_POLICY_VERSION } from './privacy-policy.generated'

const PRIVACY_POLICY_ACKNOWLEDGED_VERSION_KEY = 'privacy_policy_acknowledged_version'

export const PrivacyPolicyUpdateGate = () => {
  const { shell } = useBrowserApp()
  const [noticeVisible, setNoticeVisible] = useState(false)
  const [policyOpen, setPolicyOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    void Promise.all([
      shell.preferences.get(PRIVACY_POLICY_ACKNOWLEDGED_VERSION_KEY),
      shell.preferences.get(CONSENT_PROMPTED_KEY)
    ]).then(([acknowledgedVersion, consentPrompted]) => {
      if (cancelled || acknowledgedVersion === PRIVACY_POLICY_VERSION) {
        return
      }

      // First-run users are informed by the telemetry consent gate, whose dialog
      // already shows the current policy. Seed the acknowledgement so they are not
      // also shown a misleading "policy updated" notice for a policy they have not
      // seen before. Only returning users who acknowledged an older version see it.
      if (consentPrompted !== 'true') {
        void shell.preferences.set(PRIVACY_POLICY_ACKNOWLEDGED_VERSION_KEY, PRIVACY_POLICY_VERSION)
        return
      }

      setNoticeVisible(true)
    })

    return () => {
      cancelled = true
    }
  }, [shell.preferences])

  const acknowledge = async () => {
    await shell.preferences.set(PRIVACY_POLICY_ACKNOWLEDGED_VERSION_KEY, PRIVACY_POLICY_VERSION)
  }

  const closeNotice = async () => {
    await acknowledge()
    setNoticeVisible(false)
  }

  return (
    <>
      {noticeVisible ? (
        <>
          <div className="fixed inset-0 z-[55] bg-stone-900/20 backdrop-blur-[1px]" />
          <div className="fixed inset-x-4 bottom-4 z-[60] mx-auto max-w-lg rounded-2xl border border-amber-200 bg-white p-4 shadow-xl">
            <MarkdownDocument
              markdown={PRIVACY_POLICY_UPDATE_NOTICE}
              className="[&>*:first-child]:mt-0"
            />
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  void closeNotice()
                }}
                className="rounded-md border border-stone-200 px-3 py-1.5 text-sm text-stone-700 transition-colors hover:bg-stone-50"
              >
                Dismiss
              </button>
              <button
                type="button"
                onClick={() => {
                  void acknowledge()
                  setPolicyOpen(true)
                  setNoticeVisible(false)
                }}
                className="rounded-md bg-stone-900 px-3 py-1.5 text-sm text-white transition-colors hover:bg-stone-700"
              >
                Review update
              </button>
            </div>
          </div>
        </>
      ) : null}
      <PrivacyPolicyDialog
        open={policyOpen}
        onClose={() => setPolicyOpen(false)}
        onOpen={() => void acknowledge()}
      />
    </>
  )
}
