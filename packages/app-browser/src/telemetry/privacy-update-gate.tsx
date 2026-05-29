import { useEffect, useState } from 'react'
import { useBrowserApp } from '../app'
import { PrivacyPolicyDialog } from './privacy-policy-dialog'
import { PRIVACY_POLICY_VERSION } from './privacy-policy.generated'

const PRIVACY_POLICY_ACKNOWLEDGED_VERSION_KEY = 'privacy_policy_acknowledged_version'

export const PrivacyPolicyUpdateGate = () => {
  const { shell } = useBrowserApp()
  const [noticeVisible, setNoticeVisible] = useState(false)
  const [policyOpen, setPolicyOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    void shell.preferences.get(PRIVACY_POLICY_ACKNOWLEDGED_VERSION_KEY).then((value) => {
      if (!cancelled && value !== PRIVACY_POLICY_VERSION) {
        setNoticeVisible(true)
      }
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

  if (!noticeVisible) {
    return null
  }

  return (
    <>
      <div className="fixed inset-0 z-[55] bg-stone-900/20 backdrop-blur-[1px]" />
      <div className="fixed inset-x-4 bottom-4 z-[60] mx-auto max-w-lg rounded-2xl border border-amber-200 bg-white p-4 shadow-xl">
        <h2 className="text-sm font-semibold text-stone-900">Privacy policy updated</h2>
        <p className="mt-2 text-sm text-stone-700">
          We updated the privacy policy to document Web Speech API voice input, including that
          speech recognition depends on your browser or device vendor and may run locally or in the
          cloud.
        </p>
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
      <PrivacyPolicyDialog open={policyOpen} onClose={() => setPolicyOpen(false)} onOpen={() => void acknowledge()} />
    </>
  )
}
