// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { BrowserApp } from '../src/app.js'
import { AppBrowserProvider } from '../src/app.js'
import { PrivacyPolicyUpdateGate } from '../src/telemetry/privacy-update-gate.js'
import { CONSENT_PROMPTED_KEY } from '../src/telemetry/consent-gate.js'
import { PRIVACY_POLICY_VERSION } from '../src/telemetry/privacy-policy.generated.js'

const ACK_KEY = 'privacy_policy_acknowledged_version'

const makeApp = (
  seed: Record<string, string> = {}
): { app: BrowserApp; store: Map<string, string> } => {
  const store = new Map<string, string>(Object.entries(seed))
  const app = {
    shell: {
      preferences: {
        get: (key: string) => Promise.resolve(store.get(key)),
        set: (key: string, value: string) => {
          store.set(key, value)
          return Promise.resolve()
        }
      }
    },
    stores: {}
  } as unknown as BrowserApp
  return { app, store }
}

const renderGate = (app: BrowserApp): void => {
  render(
    <AppBrowserProvider app={app}>
      <PrivacyPolicyUpdateGate />
    </AppBrowserProvider>
  )
}

afterEach(() => {
  cleanup()
})

describe('PrivacyPolicyUpdateGate', () => {
  it('shows the notice and opens the policy dialog from "Review update" for returning users', async () => {
    const { app } = makeApp({ [CONSENT_PROMPTED_KEY]: 'true', [ACK_KEY]: 'older-version' })
    renderGate(app)

    await screen.findByText('Privacy policy updated')
    fireEvent.click(screen.getByRole('button', { name: /review update/i }))

    expect(await screen.findByRole('dialog', { name: /privacy & telemetry/i })).toBeInTheDocument()
  })

  it('suppresses the notice on first run and seeds the acknowledgement', async () => {
    const { app, store } = makeApp()
    renderGate(app)

    await waitFor(() => {
      expect(store.get(ACK_KEY)).toBe(PRIVACY_POLICY_VERSION)
    })
    expect(screen.queryByText('Privacy policy updated')).toBeNull()
  })

  it('does not show the notice when the current version is already acknowledged', async () => {
    const { app } = makeApp({ [CONSENT_PROMPTED_KEY]: 'true', [ACK_KEY]: PRIVACY_POLICY_VERSION })
    renderGate(app)

    await waitFor(() => {
      expect(screen.queryByText('Privacy policy updated')).toBeNull()
    })
  })
})
